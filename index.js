import db from "./db/index.js";
import config from "./config.js";
import { parse } from "node-html-parser";
import fs from "fs";

const forumFiles = [];
const topicFiles = [];
let forumEntries = [];
const announcements = [];
const users = new Map();
const idlessUsers = new Map();
const errors = [];
let idlessUserID = 100000;


fs.readdirSync(config.inputFolder, "utf-8").forEach((file) => {
	if (file.startsWith("viewforum")) forumFiles.push(file);
	if (file.startsWith("viewtopic")) topicFiles.push(file);
});

console.log(`Enumerated forum dump: ${forumFiles.length} forum files, ${topicFiles.length} topic files`);

parseIndex(config.inputFolder + "/index.html");

for (const file of forumFiles) {
	await parseForumPage(file);
};

//parseTopicPage("viewtopic0ab0.html");

for (const file of topicFiles) {
	await parseTopicPage(file);
};

console.log(`Errors encountered this run:`);
for (const error of errors) {
	if (error.errObj) console.error(`${error.page}: ${error.reason} (${error.errObj})`);
	else console.error(`${error.page}: ${error.reason}`);
}

async function parseIndex(fileName) {
	const indexFile = fs.readFileSync(fileName);
	const root = parse(indexFile);
	const categories = root.querySelectorAll("div.forabg");
	categories.forEach((category) => {
		const categoryLink = category.querySelector("li.header div.list-inner a")
		const categoryId = categoryLink.getAttribute("data-id");
		const categoryName = categoryLink.innerText;
		forumEntries.push({id: categoryId, name: categoryName});
		const categoryForums = category.querySelectorAll("li.row");
		categoryForums.forEach((forum) => {
			const forumId = forum.querySelector("div.list-inner a").getAttribute("data-id");
			const forumName = forum.querySelector("div.list-inner a").innerText;
			let forumDescription = "";
			if (forum.querySelector("div.list-inner div.forum-description")) forumDescription = forum.querySelector("div.list-inner div.forum-description").innerText;
			forumEntries.push({
				id: forumId,
				name: forumName,
				description: forumDescription,
				parentId: categoryId
			});
		});
	});
	console.log("Parsed index page!");
	await db.Forum.bulkCreate(forumEntries, {
		fields: ["id", "name", "description", "parentId"],
		updateOnDuplicate: ["name", "description", "parentId"]
	});
	console.log(`Updated Forum DB`);
}

async function parseForumPage(file) {
	console.log(`Called to parse ${file}`);
	const forumPage = fs.readFileSync(config.inputFolder + "/" + file);
	const forumParsed = parse(forumPage);
	let forumId = 0;
	if (forumParsed.querySelector("h2.login-title")) {
		console.log(`Page ${file} is a login page, skipping...`);
		errors.push({page: file, reason: "Login Page"});
		return;
	}
	const breadcrumbs = forumParsed.querySelectorAll("div.navbar.nav-breadcrumbs span.crumb");
	const topics = [];
	let addedAnnouncements = false;
	breadcrumbs.forEach((crumb) => {
		if (crumb.hasAttribute("data-forum-id")) forumId = crumb.getAttribute("data-forum-id");
	});
	
	if (forumId == 0) {
		throw new Error("Unable to find Forum ID");
	}
	const announcementLines = forumParsed.querySelectorAll("div.forumbg.announcement ul.topics div.list-inner");
	announcementLines.forEach((announcement) => {
		const parsedAnnouncement = parseTopicLine(announcement);
		parsedAnnouncement.isAnnouncement = true;
		if (!users.has(parsedAnnouncement.UserId)) users.set(parsedAnnouncement.UserId, parsedAnnouncement.userName);
		topics.push(parsedAnnouncement);
	});
	const topicLines = forumParsed.querySelectorAll("div.forumbg:not(.announcement) li.row");
	topicLines.forEach((line) => {
		const parsedTopic = parseTopicLine(line);
		if (!users.has(parsedTopic.UserId)) users.set(parsedTopic.UserId, parsedTopic.userName);
		if (!topics.find((topic) => topic.id == parsedTopic.id)) topics.push(parsedTopic);
	});
	const userArray = [];
	users.forEach((value, key) => {
		userArray.push({id: key, name: value});
	});
	await db.User.bulkCreate(userArray, {
		fields: [ "id", "name" ],
		updateOnDuplicate: [ "name" ]
	});
	console.log(`Created/Updated ${userArray.length} user skeletons`);
	await db.Topic.bulkCreate(topics, {
		fields: ["ForumId", "id", "name", "dateCreated", "UserId", "isAnnouncement"],
		updateOnDuplicate: ["ForumId", "name", "dateCreated", "UserId", "isAnnouncement"]
	});
	console.log(`Created topics for ${file}, Currently ${idlessUsers.size} ID-less users...`);
}

function parseTopicLine(line) {
	const link = line.querySelector("a.topictitle");
	let url = link.getAttribute("href");
	const urlParser = /^[\w\.\-:\/]+\?f=(?<ForumId>\d+)\&t=(?<TopicId>\d+)$/;
	if (!urlParser.test(url)) {
		throw new Error("Unable to parse link", link);
	}
	const urlMatch = urlParser.exec(url).groups;
	const forumId = urlMatch.ForumId;
	const topicId = urlMatch.TopicId;
	const topicName = link.innerText;
	const postedByline = line.querySelector("div.responsive-hide");
	let userId = 0;
	let userName = "";
	if (postedByline.querySelector("a.username")) {
		const postedUserLink = postedByline.querySelector("a.username").getAttribute("href");
		const userIdRegex = /^[\w\.\-:\/]+\?mode=viewprofile&u=(?<UserId>\d+)$/;
		userId = userIdRegex.exec(postedUserLink).groups.UserId;
		userName = postedByline.querySelector("a").innerText;
	} else {
		userName = postedByline.querySelector("span.username").innerText;
		userId = getIdlessUserId(userName);
	}
	let dateNode = postedByline.childNodes[2];
	const dateRegex = /^\s(»|&raquo;)\s(?<Day>\d{1,2})\s(?<MonthAbbrev>\w{3})\s(?<Year>\d{4}),\s(?<Time>\d{2}:\d{2})/;
	if (!dateRegex.test(dateNode)) {
		dateNode = postedByline.childNodes[4];
	}
	const dateGroups = dateRegex.exec(dateNode).groups;
	const dateParsed = Date.parse(`${dateGroups.Day} ${dateGroups.MonthAbbrev} ${dateGroups.Year} ${dateGroups.Time}`);
	return {ForumId: forumId, id: topicId, name: topicName, dateCreated: dateParsed, UserId: userId, userName: userName};
}

async function parseTopicPage(file) {
	console.log(`Called to parse ${file}`);
	const topicParsed = parse(fs.readFileSync(config.inputFolder + "/" + file));
	const users = [], posts = [];
	let forumId = 0;
	if (topicParsed.querySelector("h2.login-title")) {
		console.log(`Page ${file} is a login page, skipping...`);
		errors.push({page: file, reason: "Login Page"});
		return;
	}
	const breadcrumbs = topicParsed.querySelectorAll("div.navbar.nav-breadcrumbs span.crumb");
	breadcrumbs.forEach((crumb) => {
		if (crumb.hasAttribute("data-forum-id")) forumId = crumb.getAttribute("data-forum-id");
	});
	if (forumId == 0) {
		console.log(`Couldn't parse ${file}, skipping...`);
		errors.push({page: file, reason: "Couldn't find Forum ID"});
		return
		//throw new Error("Unable to find Forum ID");
	}
	const topicTitleElem = topicParsed.querySelector("h2.topic-title a");
	const topicTitle = topicTitleElem.innerText;
	const topicUrlParser = /^[\w\.\-:\/]+\?f=(?<ForumId>\d+)\&t=(?<TopicId>\d+)/;
	const topicParsedURL = topicUrlParser.exec(topicTitleElem.getAttribute("href")).groups;
	const topicId = topicParsedURL.TopicId;
	const postObjects = topicParsed.querySelectorAll("div#page-body div.post");
	if (postObjects.length == 0) {
		console.error(`Failed to parse ${file}, couldn't find any posts. Skipping...`);
		errors.push({page: file, reason: "Couldn't find posts - Parser eror?"});
		return;
	}
	postObjects.forEach((postElem) => {
		const { user, post } = parsePost(postElem, topicId);
		if (!users.find((found) => found.id == user.id)) users.push(user);
		posts.push(post);
	});
	try {
		await db.User.bulkCreate(users, {
			fields: ["id", "name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo"],
			updateOnDuplicate: ["name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo"]
		});
	} catch(e) {
		console.error(`Error saving users in file ${file}: ${e}`);
		errors.push({page: file, reason: "Error saving users", errObj: e});
	}
	try {
		const topicEntry = await db.Topic.findOrCreate({
			where: {
				id: topicId
			},
			defaults: {
				name: topicTitle,
				dateCreated: posts[0].datePosted,
				UserId: users[0].id,
				ForumId: forumId
			}
		});
	} catch(e) {
		console.error(`Got error creating topic: ${e}`);
		errors.push({page: file, reason: "Error creating topic", errObj: e});
	}
	try {
		await db.Post.bulkCreate(posts, {
			fields: ["id", "subject", "datePosted", "body", "UserId", "TopicId"],
			updateOnDuplicate: ["subject", "datePosted", "body", "UserId", "TopicId"]
		});
	} catch(e) {
		console.error(`Error saving posts in file ${file}: ${e}`);
		errors.push({page: file, reason: "Error saving posts", errObj: e});
	}
		
	console.log(`Written ${file} to DB, Currently ${idlessUsers.size} ID-less users...`);
}

function parsePost(post, topicId) {
	const postId = post.getAttribute("id").substring(1);
	const user = parseProfileCard(post.querySelector("dl.postprofile"));
	const postSubject = post.querySelector("div.postbody h3 a").innerText;
	const dateRegex = /(?<Day>\d{1,2})\s(?<MonthAbbrev>\w{3})\s(?<Year>\d{4}),\s(?<Time>\d{2}:\d{2})/;
	const dateGroups = dateRegex.exec(post.querySelector("div.postbody p.author").lastChild.innerText).groups;
	const postDate = Date.parse(`${dateGroups.Day} ${dateGroups.MonthAbbrev} ${dateGroups.Year} ${dateGroups.Time}`);
	const postBody = post.querySelector("div.content").innerHTML;
	return {user: user, post: { id: postId, subject: postSubject, datePosted: postDate, body: postBody, UserId: user.id, TopicId: topicId }};
}

function parseProfileCard(card) {
	const userDetails = {};
	if (card.querySelector("a.username")) {
		userDetails.name = card.querySelector("a.username").innerText;
		const userIdRegex = /^[\w\.\-:\/]+\?mode=viewprofile&u=(?<UserId>\d+)$/;
		userDetails.id = userIdRegex.exec(card.querySelector("a.username").getAttribute("href")).groups.UserId;
	} else {
		userDetails.name = card.querySelector("span.username").innerText;
		if (idlessUsers.has(userDetails.name)) userDetails.id = idlessUsers.get(userDetails.name);
		else userDetails.id = getIdlessUserId(userDetails.name);
	}
	if (card.querySelector("img.avatar")) {
		const avatar = card.querySelector("img.avatar");
		userDetails.avatar = avatar.getAttribute("src");
		userDetails.avatarHeight = avatar.getAttribute("height");
		userDetails.avatarWidth = avatar.getAttribute("width");
	}
	if (card.querySelector("dd.profile-rank")) userDetails.rank = card.querySelector("dd.profile-rank").innerText;
	if (card.querySelector("dd.profile-firstvideo")) userDetails.firstVideo = card.querySelector("dd.profile-firstvideo").lastChild.innerText;
	if (card.querySelector("dd.profile-phpbb_location")) userDetails.location = card.querySelector("dd.profile-phpbb_location").lastChild.innerText;
	return userDetails;
}

function getIdlessUserId(name) {
	let userId;
	if (!idlessUsers.has(name)) {
		userId = idlessUserID++;
		idlessUsers.set(name, userId);
	} else {
		userId = idlessUsers.get(name);
	}
	return userId;
}