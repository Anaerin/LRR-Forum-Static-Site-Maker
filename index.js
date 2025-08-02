import { Op, sequelize } from "./db/index.js";
import config from "./config.js";
import { parse } from "node-html-parser";
import fs from "fs";
import templates from "./templates/index.js";
import { create } from "domain";
import path from "node:path";
import { createLink } from "./lib/utils.js";
import { siteParser } from "./lib/parseSite.js";
import { QueryTypes } from "sequelize";

const parseFiles = false;
const createMirror = true;
const forumParts = new Map();
const errors = [];
if (parseFiles) {
	const fileParser = new siteParser(sequelize);
	await fileParser.parseSite();
};

if (createMirror) {
	const forumCounts = await sequelize.models.Forum.count();
	if (forumCounts < 1) {
		console.error(`Unable to find any forums to render. Do you need to parse the forum backup?`);
		//return;
	}
	console.log(`Creating index page for ${forumCounts} forums and categories`);
	const forumIndex = await sequelize.query(`
			WITH
				TopicCounts as (
					SELECT COUNT(TPC.id) AS TopicCountTopics, SUM(TPC.PostCount) AS PostCount, TPC.ForumId
					FROM (
						SELECT Topics.id, Topics.ForumId, COUNT(Posts.id) AS PostCount
						FROM Topics
						LEFT JOIN Posts ON Posts.TopicId = Topics.id
						GROUP BY Posts.TopicId
						ORDER BY Topics.ForumId
					) AS TPC
					GROUP BY TPC.ForumId
				),
				LatestTopics AS ( 
					SELECT Topics.name AS LatestPostName, 
						Topics.id AS LatestTopicId, 
						Users.name AS LatestUserName, 
						Posts.datePosted AS LatestPostDate, 
						Topics.ForumId
					FROM Topics
					INNER JOIN Posts ON Posts.TopicId = Topics.id
					AND Posts.id IN (
						SELECT MAX(PP.id)
						FROM Posts AS PP
						GROUP BY PP.TopicId
					)
					INNER JOIN Users ON Users.id = Posts.UserId
					ORDER BY Posts.datePosted DESC
				)
			SELECT Forums.id, 
				Forums.name, 
				Forums.description, 
				Forums.parentId, 
				TopicCounts.TopicCountTopics AS TopicCount, 
				TopicCounts.PostCount AS PostCount, 
				LatestTopics.LatestPostName, 
				LatestTopics.LatestPostDate, 
				LatestTopics.LatestUserName,
				MAX(LatestTopics.LatestTopicId)
			FROM Forums
			LEFT JOIN TopicCounts ON TopicCounts.ForumId = Forums.id
			LEFT JOIN LatestTopics ON LatestTopics.ForumId = Forums.id
			GROUP BY Forums.id
			ORDER BY Forums.parentId, Forums.id
		`, {
			type: sequelize.QueryTypes.SELECT,
	});
	// We have a flat interpretation of the forum structure, build it into a tree (ish)
	const forumsByParent = new Map();
	const forumsWithTopics = [];
	const foraById = new Map();
	forumIndex.forEach((forum) => {
		if (forumsByParent.has(forum.parentId)) forumsByParent.set(forum.parentId, [...forumsByParent.get(forum.parentId), forum]);
		else forumsByParent.set(forum.parentId, [ forum ]);
		foraById.set(forum.id, forum);
		if (forum.TopicCount > 0) {
			forumsWithTopics.push(forum.id);
		}
	});
	const rootCategories = forumsByParent.get(null);
	const forumList = await renderForumList(forumsByParent, rootCategories, true);
	const forumRender = templates.forum({
		forumPage: forumList,
		title: "Index page"
	});
	writeFile("index.htm", forumRender);
	console.log(`Written index.htm`);
	forumParts.forEach((val, key) => {
		const forumPage = templates.forum({
			forumPage: templates.categoryline({id: key, name: val.name, childForums: val.contents}),
			title: val.name
		});
		const pageLink = createLink("forum", {f: key});
		writeFile(pageLink, forumPage);
		console.log(`Written ${pageLink}`);
	});
	const breadcrumbLinks = new Map();
	for (const forumId of forumsWithTopics) {
		const breadcrumbs = [];
		const forum = foraById.get(forumId);
		let currentForumId = forumId;
		while (currentForumId) {
			if (forumsWithTopics.includes(currentForumId)) breadcrumbs.push({url: createLink("topics", {f: currentForumId}), title: foraById.get(currentForumId).name});
			else breadcrumbs.push({url: createLink("forum", {f: currentForumId}), title: foraById.get(currentForumId).name});
			currentForumId = foraById.get(currentForumId).parentId;
		}
		breadcrumbs.reverse();
		console.log(`Querying for topics for forum ${foraById.get(forumId).name}...`);
		const topics = await sequelize.query(`
			SELECT Topics.id, Topics.name AS TopicName, Topics.dateCreated, Topics.isAnnouncement, Topics.isPinned,  
			TopicUsers.name AS TopicUserName, LatestPost.id AS PostID, Users.name AS LatestPostUserName, LatestPost.datePosted, COUNT(PostCount.id) AS PostCount
			FROM Topics
			LEFT JOIN Posts AS LatestPost ON (
				LatestPost.TopicId = Topics.id
				AND LatestPost.id IN (
					SELECT MAX(PP.id) 
					FROM Posts AS PP 
					GROUP BY PP.TopicId
				)
			)
			LEFT JOIN Posts AS PostCount ON Topics.id = PostCount.TopicId
			LEFT JOIN Users ON Users.id = LatestPost.UserId
			LEFT JOIN Users AS TopicUsers ON TopicUsers.id = Topics.UserId
			WHERE Topics.ForumId = :forumId
			GROUP BY Topics.id
			ORDER BY Topics.isPinned DESC, LatestPost.datePosted DESC`, 
			{
				replacements: { forumId },
				type: sequelize.QueryTypes.SELECT
			}
		);
		console.log(`Query complete, got ${topics.length} topics.`);
		const pages = Math.floor(topics.length / config.topicsPerPage);
		for (let page = 0; page <= pages; page++) {
			let topicPageContents = "";
			const startPoint = page * config.topicsPerPage;
			for (let i = startPoint; i<Math.min((startPoint + config.topicsPerPage), topics.length); i++) {
				const topicRef = topics[i];
				const topicLineData = {
					forumName: forum.name,
					forumId: forumId,
					topicId: topicRef.id,
					pages: Math.floor(topicRef.PostCount / config.postsPerPage),
					isPinned: topicRef.isPinned,
					postCount: topicRef.PostCount,
					topicName: topicRef.TopicName,
					topicUserName: topicRef.TopicUserName,
					topicDateCreated: topicRef.dateCreated,
					topicLink: createLink("posts", {f: forumId, t: topicRef.id}),
					topicLatestPostedBy: topicRef.LatestPostUserName,
					topicLatestPostedOn: topicRef.datePosted,
					topicLatestPostedLink: createLink("posts", {f: forumId, t:topicRef.id, p:pages},"#" + topicRef.PostID)
				};
				topicPageContents += templates.topicline(topicLineData);
			}
			let pageLink = "";
			if (page > 0) pageLink = createLink("topics", {f: forumId, p: page});
			else pageLink = createLink("topics", {f: forumId});
			const pageContents = templates.topic({
				title: forum.name,
				page: page,
				pages: pages,
				topicLines: topicPageContents,
				topicCount: topics.length,
				forumId,
				breadcrumbs
			});
			console.log(`writing ${pageLink}...`);
			writeFile(pageLink, pageContents);
			topicPageContents = "";
		}
		const users = new Map();
		const userArray = await sequelize.query(`
			SELECT Users.id, Users.name, Users.avatar, Users.avatarHeight, Users.avatarWidth, Users.location, Users.rank, Users.firstVideo, COUNT(Posts.id) AS PostCount, Users.signature FROM Users
			INNER JOIN Posts
			ON Posts.UserId = Users.id
			GROUP BY Posts.UserId
		`, {
			type: QueryTypes.SELECT,
			raw: true
		});
		userArray.forEach((user) => {
			users.set(user.id, user);
		});
		let postTopics;
		try {
			postTopics = await sequelize.models.Topic.findAll({ where: {
				forumId: forumId
			}});
		} catch (e) {
			console.error(`Unable to fetch topics: ${e}`);
		}
		for (const topic of postTopics) {
			const postCount = await topic.countPosts();
			let start = 0, page = 0, pages = Math.floor(postCount / config.postsPerPage);
			if (postCount > 0) {
				while (start < postCount) {
					const posts = await topic.getPosts({
						limit: config.postsPerPage,
						offset: start,
						order: [[ "datePosted", "ASC"]]
					});
					let postLines = [];
					for (const post of posts) {
						const postDetails = {
							id: post.id,
							subject: post.subject,
							datePosted: post.datePosted,
							body: post.body,
							user: users.get(post.UserId)
						};
						postLines.push(templates.postline(postDetails));
					}
					let pageLink = "";
					const threadLink = createLink("posts", {f: forumId, t: topic.id});
					if (page > 0) pageLink = createLink("posts", {f: forumId, t: topic.id, p: page});
					else pageLink = threadLink
					let pageContents = templates.posts({
						breadcrumbs,
						threadLink,
						name: topic.name,
						topicCount: postCount,
						forumId,
						topicId: topic.id,
						page,
						pages,
						postLines: postLines.join("")
					});
					console.log(`Writing file ${pageLink}...`);
					writeFile(pageLink, pageContents);
					postLines.length = 0;
					page++;
					start += config.postsPerPage;
				}
			} else {
				const threadLink = createLink("posts", {f: forumId, t: topic.id});
					let pageContents = templates.posts({
						breadcrumbs,
						threadLink,
						name: topic.name,
						topicCount: postCount,
						forumId,
						topicId: topic.id,
						page,
						pages,
						postLines: `<div><h1>Topic missing from backup</h1></div>`
					});
					console.warn(`Writing empty file ${threadLink}...`);
					errors.push({reason: "Missing Topic", page: threadLink});
					writeFile(threadLink, pageContents);
			}
		}
	};
	console.log(`Finished processing.`);
}

//writeFile("test.htm", templates.paginationtest());
console.log(`Encountered ${errors.length} errors this run:`);
for (const error of errors) {
	if (error.errObj) console.error(`${error.page}: ${error.reason} (${error.errObj})`);
	else console.error(`${error.page}: ${error.reason}`);
}

async function renderForumList(forumsByParent, currentForum, isCategory) {
	let out = "";
	for (const forum of currentForum) {
		let childForums = "";
		if (forumsByParent.has(forum.id)) {
			childForums = await renderForumList(forumsByParent, forumsByParent.get(forum.id), false);
		}
		if (!isCategory) {
			out += templates.forumline({
				id: forum.id, 
				name: forum.name, 
				description: forum.description, 
				link: createLink("topics", {f: forum.id}),
				topicCount: forum.TopicCount, 
				postCount: forum.PostCount, 
				lastpostsubject: forum.LatestPostName, 
				lastpostpostedBy: forum.LatestUserName, 
				lastpostpostDate: forum.LatestPostDate,
				lastpostlink: createLink("posts", {f: forum.id, t: forum.LatestTopicId}),
				subforum: childForums
			});
		} else {
			forumParts.set(forum.id, {name: forum.name, contents: childForums});
			out += templates.categoryline({
				id: forum.id, 
				name: forum.name,
				link: createLink("forum", { f: forum.id }),
				childForums
			});
		}
	}
	return out;
}

async function renderTopics(forumsByParent, currentForum) {
	const forumTopics = await sequelize.query(`
		SELECT Topics.id, Topics.name, Topics.dateCreated, Topics.isAccouncement, Topics.UserId
		FROM Topics
		WHERE Topics.ForumId = :forumId
		ORDER BY dateCreated DESC`);
	
}

async function getTopicsForForum(forumId, pageNumber = 0) {
	const queryOpts = {
		replacements: { forumId },
		type: sequelize.QueryTypes.SELECT,
		limit: config.topicsPerPage
	};
	if (pageNumber > 0) {
		queryOpts.offset = config.topicsPerPage * pageNumber
	};
	const results = await sequelize.query(`
		SELECT Topics.id, Topics.name AS TopicName, Topics.dateCreated, Topics.isAnnouncement, Topics.isPinned, Topics.UserId, Posts.id AS PostID, Users.name AS UserName, Posts.datePosted
		FROM Topics
		LEFT JOIN Posts ON (
			Posts.TopicId = Topics.id
			AND Posts.id IN (
				SELECT MAX(PP.id) 
				FROM Posts AS PP 
				GROUP BY PP.TopicId
			)
		)
		LEFT JOIN Users ON Users.id = Posts.UserId
		WHERE Topics.ForumId = :forumId
		ORDER BY Topics.isPinned DESC, Posts.datePosted DESC`, queryOpts);
	return results;
}
/*
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
	await sequelize.models.Forum.bulkCreate(forumEntries, {
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
	await sequelize.models.User.bulkCreate(userArray, {
		fields: [ "id", "name" ],
		updateOnDuplicate: [ "name" ]
	});
	console.log(`Created/Updated ${userArray.length} user skeletons`);
	await sequelize.models.Topic.bulkCreate(topics, {
		fields: ["ForumId", "id", "name", "dateCreated", "UserId", "isAnnouncement", "isPinned"],
		updateOnDuplicate: ["ForumId", "name", "dateCreated", "UserId", "isAnnouncement", "isPinned"]
	});
	console.log(`Created topics for ${file}, Currently ${idlessUsers.size} ID-less users...`);
}

function parseTopicLine(line) {
	let isSticky = false;
	if (line.classList.contains("sticky")) {
		isSticky = true;
	}
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
	return {ForumId: forumId, id: topicId, name: topicName, dateCreated: dateParsed, UserId: userId, userName: userName, isPinned: isSticky};
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
	let newestPostDate = 0, newestPostId;
	if (postObjects.length == 0) {
		console.error(`Failed to parse ${file}, couldn't find any posts. Skipping...`);
		errors.push({page: file, reason: "Couldn't find posts - Parser eror?"});
		return;
	}
	postObjects.forEach((postElem) => {
		const { user, post } = parsePost(postElem, topicId);
		if (!users.find((found) => found.id == user.id)) users.push(user);
		posts.push(post);
		if (post.datePosted > newestPostDate) {
			newestPostDate = post.datePosted;
			newestPostId = post.id;
		}
	});
	try {
		await sequelize.models.User.bulkCreate(users, {
			fields: ["id", "name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo"],
			updateOnDuplicate: ["name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo"]
		});
	} catch(e) {
		console.error(`Error saving users in file ${file}: ${e}`);
		errors.push({page: file, reason: "Error saving users", errObj: e});
	}
	try {
		const topicEntry = await sequelize.models.Topic.findOrCreate({
			where: {
				id: topicId
			},
			defaults: {
				name: topicTitle,
				dateCreated: posts[0].datePosted,
				UserId: users[0].id,
				ForumId: forumId,
			}
		});
		if (topicEntry.newestPost < newestPostDate) {
			topicEntry.newestPost = newestPostDate;
			topicEntry.latestId = newestPostId;
			await topicEntry.save();
		}
	} catch(e) {
		console.error(`Got error creating topic: ${e}`);
		errors.push({page: file, reason: "Error creating topic", errObj: e});
	}
	try {
		await sequelize.models.Post.bulkCreate(posts, {
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
*/
function writeFile(filename, contents) {
	const resolvedPath = path.resolve(config.outputFolder, filename);
	fs.writeFileSync(resolvedPath, contents, { flush: true, encoding: "utf8" }, (err) => {
		console.error(`Error writing file ${filename} to ${resolvedPath}: ${err}`);
	});
}
