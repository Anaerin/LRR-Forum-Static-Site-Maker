import config from "../config.js";
import fs from "fs";
import path from "path";
import { parse } from "node-html-parser";
import { getIdlessUserId, getIdlessUserCount, reportProgress, estimateTTC } from "./utils.js";
import crypto from "crypto";
import { Readable } from "stream";
import WaybackRetriever from "./waybackretrieval.js";
import { finished } from "stream/promises";
import progress from "./progress.js";

export default class siteParser {	
	errors = [];
	users = new Map();
	forumFiles = [];
	topicFiles = [];
	idlessUsers = new Map();
	assetList = new Map();
	parsedTopicCounts = new Map();
	parsedPostCounts = new Map();
	savedTopicCounts = new Map();
	savedPostCounts = new Map();
	missingAssets = new Map();
	usersByName = new Map();
	forumsById = new Map();
	Tasks = [
			{taskName: "parseForum", description: "Parse forum pages"},
			{taskName: "parseTopics", description: "Parse topic pages"}
		];
	forums = 0;
	topics = 0;
	posts = 0;
	constructor(db) {
		this.db = db;
		this.wayback = new WaybackRetriever();
	}
	async recordMissingAssets() {
		const missing = [];
		this.assetList.forEach((value, key) => {
			if (!value.id) {
				missing.push({URL: key, fileName: value.fileName});
			}
		});
		await this.db.models.Asset.bulkCreate(missing, {
			fields: ["URL", "fileName"],
			updateOnDuplicate: ["URL", "fileName"]
		});
	}

	async parseSite() {
		this.forumFiles.length = 0;
		this.topicFiles.length = 0;
		fs.readdirSync(config.inputFolder, "utf-8").forEach((file) => {
			if (file.startsWith("viewforum")) this.forumFiles.push(file);
			if (file.startsWith("viewtopic")) this.topicFiles.push(file);
		});

		console.log(`Enumerated forum dump: ${this.forumFiles.length} forum files, ${this.topicFiles.length} topic files`);
		const assets = await this.db.models.Asset.findAll({raw: true});
		this.assetList.clear();
		assets.forEach((asset) => {
			this.assetList.set(asset.URL, asset);
		});
		this.parseIndex(config.inputFolder + "/index.html");

		let counter = 0;
		progress.startTask("parseForum");
		for (const file of this.forumFiles) {
			progress.updateTask("parseForum", counter, this.forumFiles.length);
			counter++;
			await this.parseForumPage(file);
		};
		const forumTopicCounts = await this.db.query(`SELECT Forums.id, COUNT(Topics.id) AS TopicCount
			FROM Forums
			INNER JOIN Topics ON Topics.ForumId = Forums.id
			GROUP BY Forums.id`, {
				type: this.db.QueryTypes.SELECT
			});
		for (const forum of forumTopicCounts) {
			this.topics += forum.TopicCount;
			if (this.parsedTopicCounts.has(forum.id)) {
				const parsedForumCount = this.parsedTopicCounts.get(forum.id);
				if (parsedForumCount < forum.TopicCount) {
					console.warn(`Forum ${forum.id} has ${forum.TopicCount}, but should have ${parsedForumCount} topics.`);
				}
			}
		}
		progress.completeTask("parseForum");
		progress.startTask("parseTopics");
		counter = 0;
		for (const file of this.topicFiles) {
			progress.updateTask("parseTopics", counter, this.topicFiles.length);
			counter++;
			await this.parseTopicPage(file);
		};
		await this.updateAssetDB();
		const topicPostCounts = await this.db.query(`SELECT Topics.id, COUNT(Posts.id) AS PostCount
			FROM Topics
			INNER JOIN Posts ON Topics.id = Posts.TopicId
			GROUP BY Topics.id`, {
				type: this.db.QueryTypes.SELECT
			});
		for (const topic of topicPostCounts) {
			if (this.parsedPostCounts.has(topic.id)) {
				this.PostCount += topicPostCounts.PostCount;
				const parsedTopicCount = this.parsedPostCounts.get(topic.id);
				if (parsedTopicCount < topic.TopicCount) {
					console.warn(`Topic ${topic.id} has ${topic.PostCount}, but should have ${parsedTopicCount} posts.`);
				}
			}
		}
		progress.completeTask("parseTopics");
		await this.recordMissingAssets();
	}
	async getNextURL(pageContents, pageURL) {
		const parsedPage = parse(pageContents);
		this.parseTopicData(parsedPage, pageURL);
		await this.updateAssetDB();
		await this.recordMissingAssets();
		const nextButton = parsedPage.querySelector("div.pagination li.next a");
		if (nextButton) return nextButton.getAttribute("href");
	}

	async parseIndex(fileName) {
		const indexFile = fs.readFileSync(fileName);
		const root = parse(indexFile);
		const categories = root.querySelectorAll("div.forabg");
		const forumEntries = [];
		categories.forEach((category) => {
			const categoryLink = category.querySelector("li.header div.list-inner a")
			const categoryId = categoryLink.getAttribute("data-id");
			const categoryName = categoryLink.innerText;
			forumEntries.push({id: categoryId, name: categoryName});
			const categoryForums = category.querySelectorAll("li.row");
			categoryForums.forEach((forum) => {
				const forumId = forum.querySelector("div.list-inner a").getAttribute("data-id");
				const forumName = forum.querySelector("div.list-inner a").innerText;
				const forumTopics = forum.querySelector("dd.topics").firstChild.innerText;
				let forumDescription = "";
				if (forum.querySelector("div.list-inner div.forum-description")) forumDescription = forum.querySelector("div.list-inner div.forum-description").innerText;
				forumEntries.push({
					id: forumId,
					name: forumName,
					description: forumDescription,
					parentId: categoryId
				});
				this.parsedTopicCounts.set(forumId, forumTopics);
			});
		});
		console.log("Parsed index page!");
		await this.db.models.Forum.bulkCreate(forumEntries, {
			fields: ["id", "name", "description", "parentId"],
			updateOnDuplicate: ["name", "description", "parentId"]
		});
		console.log(`Updated Forum DB`);
	}

	async parseForumPage(file) {
		const forumPage = fs.readFileSync(config.inputFolder + "/" + file);
		const forumParsed = parse(forumPage);
		let forumId = 0, forumName = "", parentForumId = 0;
		if (forumParsed.querySelector("h2.login-title")) {
			console.log(`Page ${file} is a login page, skipping...`);
			this.errors.push({page: file, reason: "Login Page"});
			return;
		}
		const breadcrumbs = forumParsed.querySelectorAll("div.navbar.nav-breadcrumbs span.crumb");
		const topics = [];
		breadcrumbs.forEach((crumb) => {
			if (crumb.hasAttribute("data-forum-id")) {
				parentForumId = forumId;
				forumId = crumb.getAttribute("data-forum-id");
				forumName = crumb.querySelector("span").innerText;
			}
		});
		
		if (forumId == 0) {
			console.error(`Couldn't find Forum ID in ${file}`);
			this.errors.push({page: file, reason: "Couldn't parse or find forum ID"});
			return;
		}
		if (!this.forumsById.has(forumId)) this.forumsById.set(forumId, {name: forumName, id: forumId, parent: parentForumId});
		const announcementLines = forumParsed.querySelectorAll("div.forumbg.announcement li.row");
		announcementLines.forEach((announcement) => {
			const parsedAnnouncement = this.parseTopicLine(announcement);
			parsedAnnouncement.isAnnouncement = true;
			if (!this.users.has(parsedAnnouncement.UserId)) {
				this.users.set(parsedAnnouncement.UserId, parsedAnnouncement.userName);
				this.usersByName.set(parsedAnnouncement.userName, parsedAnnouncement.UserId);
			}
			topics.push(parsedAnnouncement);
		});
		const topicLines = forumParsed.querySelectorAll("div.forumbg:not(.announcement) li.row");
		topicLines.forEach((line) => {
			const parsedTopic = this.parseTopicLine(line);
			if (!this.users.has(parsedTopic.UserId)) {
				this.users.set(parsedTopic.UserId, parsedTopic.userName);
				this.usersByName.set(parsedTopic.userName, parsedTopic.UserId);
			}
			if (!topics.find((topic) => topic.id == parsedTopic.id)) topics.push(parsedTopic);
		});
		const userArray = [];
		this.users.forEach((value, key) => {
			userArray.push({id: key, name: value});
		});
		await this.db.models.User.bulkCreate(userArray, {
			fields: [ "id", "name" ],
			updateOnDuplicate: [ "name" ]
		});
		console.log(`Created/Updated ${userArray.length} user skeletons`);
		const forumExists = await this.db.models.Forum.findByPk(forumId);
		if (!forumExists) {
			await this.db.models.Forum.findOrCreate({
				where: { id: forumId },
				defaults: {
					name: forumName,
					parent: parentForumId
				}
			});
		}
		try {
			await this.db.models.Topic.bulkCreate(topics, {
				fields: ["ForumId", "id", "name", "dateCreated", "UserId", "isAnnouncement", "isPinned"],
				updateOnDuplicate: ["ForumId", "name", "dateCreated", "UserId", "isAnnouncement", "isPinned"]
			});
		} catch (e) {
			console.error(`Error creating topics... ${e}`);
		}
		console.log(`Created topics for ${file}, Currently ${getIdlessUserCount()} ID-less users and ${this.assetList.size} missing assets...`);
	}
	parseTopicLine(line) {
		let isSticky = false;
		if (line.classList.contains("sticky")) {
			isSticky = true;
		}
		const link = line.querySelector("a.topictitle");
		let url = link.getAttribute("href");
		const urlParser = /^[\w\.\-:\/]+\?f=(?<ForumId>\d+)(?:\&|\&amp;)t=(?<TopicId>\d+)(?:\&sid=.*)?(?:\&amp;sid=.*)?$/;
		if (!urlParser.test(url)) {
			throw new Error("Unable to parse link", link);
		}
		const urlMatch = urlParser.exec(url).groups;
		const forumId = urlMatch.ForumId;
		const topicId = urlMatch.TopicId;
		const topicName = link.innerText;
		const postedByline = line.querySelector("div.responsive-hide");
		const postedTopics = Number(line.querySelector("dd.posts").firstChild.innerText) + 1;
		this.parsedPostCounts.set(topicId, postedTopics);
		let userId = 0;
		let userName = "";
		if (postedByline.querySelector("a.username")) {
			const postedUserLink = postedByline.querySelector("a.username").getAttribute("href");
			const userIdRegex = /^[\w\.\-:\/]+\?mode=viewprofile(?:\&||&amp;)u=(?<UserId>\d+)(?:\&sid=.*)?(?:\&amp;sid=.*)?$/;
			userId = userIdRegex.exec(postedUserLink).groups.UserId;
			userName = postedByline.querySelector("a").innerText;
		} else {
			userName = postedByline.querySelector("span.username").innerText;
			if (this.usersByName.has(userName)) userId = this.usersByName.get(userName);
			else {
				userId = getIdlessUserId(userName);
				this.usersByName.set(userName, userId);
			}
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

	async parseTopicData(text, file) {
		const topicParsed = text;
		const users = [], posts = [];
		let forumId = 0;
		if (topicParsed.querySelector("h2.login-title")) {
			this.errors.push({page: file, reason: "Login Page"});
			return;
		}
		if (topicParsed.querySelector(`link[href="styles/lrr/theme/print.css"]`)) {
			this.errors.push({page: file, reason: "Print Version"});
			return;
		}
		if (topicParsed.querySelectorAll(`div#container div#forum_container table`).length > 0) {
			this.errors.push({page: file, reason: "Old forum layout"});
			return;
		}
		const breadcrumbs = topicParsed.querySelectorAll("div.navbar.nav-breadcrumbs span.crumb");
		breadcrumbs.forEach((crumb) => {
			if (crumb.hasAttribute("data-forum-id")) forumId = crumb.getAttribute("data-forum-id");
		});
		if (forumId == 0) {
			console.log(`Couldn't parse ${file} (no Forum ID), skipping...`);
			this.errors.push({page: file, reason: "Couldn't find Forum ID"});
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
			this.errors.push({page: file, reason: "Couldn't find posts - Parser eror?"});
			return;
		}
		for (const postElem of postObjects) {
			const { user, post } = await this.parsePost(postElem, topicId);
			if (!users.find((found) => found.id == user.id)) users.push(user);
			posts.push(post);
			if (post.datePosted > newestPostDate) {
				newestPostDate = post.datePosted;
				newestPostId = post.id;
			}
		};
		try {
			await this.db.models.User.bulkCreate(users, {
				fields: ["id", "name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo", "joined", "signature"],
				updateOnDuplicate: ["name", "avatar", "avatarHeight", "avatarWidth", "location", "rank", "firstVideo", "joined", "signature"]
			});
		} catch(e) {
			console.error(`Error saving users in file ${file}: ${e}`);
			this.errors.push({page: file, reason: "Error saving users", errObj: e});
		}
		try {
			const topicEntry = await this.db.models.Topic.findOrCreate({
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
			this.errors.push({page: file, reason: "Error creating topic", errObj: e});
		}
		try {
			await this.db.models.Post.bulkCreate(posts, {
				fields: ["id", "subject", "datePosted", "body", "UserId", "TopicId"],
				updateOnDuplicate: ["subject", "datePosted", "body", "UserId", "TopicId"]
			});
		} catch(e) {
			console.error(`Error saving posts in file ${file}: ${e}`);
			this.errors.push({page: file, reason: "Error saving posts", errObj: e});
		}
		console.log(`Written ${file} to DB, Currently ${getIdlessUserCount()} ID-less users... and ${this.assetList.size} missing assets...`);		
	}
	async parseTopicPage(file) {
		try {
			const fileContents = fs.readFileSync(path.join(config.inputFolder,file), "utf8");
			if (fileContents.startsWith(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"`)) {
				this.errors.push({page: file, reason: "Old forum style"});
				return;
			}
			return this.parseTopicData(parse(fileContents), file);
		} catch (e) {
			console.error(`Couldn't parse file "${file}" at "${path.join(config.inputFolder, file)}": ${e}`);
		}
	}
	async updateAssetDB() {
		try {
			const newAssets = [];
			this.assetList.forEach((value, key) => {
				if (!value.id) {
					newAssets.push({
						URL: value.URL,
						fileName: value.fileName
					});
				}
			});
			if (newAssets.length > 0) {
				await this.db.models.Asset.bulkCreate(newAssets, {
					fields: ["id", "URL", "fileName"],
					updateOnDuplicate: ["URL", "fileName"]
				});
			}
		} catch(e) {}
		finally {
			this.assetList.clear();
			const assets = await this.db.models.Asset.findAll({raw: true});
			assets.forEach((asset) => {
				this.assetList.set(asset.URL, asset);
			});
		}
	}
	async parsePost(post, topicId) {
		const postId = post.getAttribute("id").substring(1);
		const user = this.parseProfileCard(post.querySelector("dl.postprofile"));
		if (post.querySelector("div.signature")) user.signature = post.querySelector("div.signature").innerHTML;
		const postSubject = post.querySelector("div.postbody h3 a").innerText;
		const dateRegex = /(?<Day>\d{1,2})\s(?<MonthAbbrev>\w{3})\s(?<Year>\d{4}),\s(?<Time>\d{2}:\d{2})/;
		const dateGroups = dateRegex.exec(post.querySelector("div.postbody p.author").lastChild.innerText).groups;
		const postDate = Date.parse(`${dateGroups.Day} ${dateGroups.MonthAbbrev} ${dateGroups.Year} ${dateGroups.Time}`);
		const postBody = post.querySelector("div.content");
		this.markMissing(postBody);
		return {user: user, post: { id: postId, subject: postSubject, datePosted: postDate, body: postBody.innerHTML, UserId: user.id, TopicId: topicId }};
	}
	/*
	async getAsset(url, fileName) {
		console.log(`Attempting to fetch ${url} to ${fileName}`);
		let processedURL = url;
		let wasHTTPS = false;
		let wasURL = false;
		let upTree = false;
		const queryStringTest = /(\?.*)$/;
		if (processedURL.startsWith("/")) {
			//This is definitely a relative URL. Make it absolute
			processedURL = `loadingreadyrun.com${processedURL}`;
			wasURL = true;
		}
		if (processedURL.startsWith("https://")) {
			wasHTTPS = true;
			wasURL = true;
			processedURL = processedURL.substring(8);
		} else if (processedURL.startsWith("http://")) {
			wasURL = true;
			processedURL = processedURL.substring(7);
		} else if (processedURL.startsWith("../../")) {
			upTree = true;
			processedURL = processedURL.substring(6);
		}
		if (!wasURL && !upTree && this.copyFileTo(`${processedURL}`, fileName)) return true;
		if (this.copyFileTo(`../../${processedURL}`, fileName)) return true;
		if (wasURL && processedURL.startsWith("www") && this.downloadFileTo(processedURL.substring(3), fileName)) return true;
		if (!wasHTTPS && await this.downloadFileTo(`http://${processedURL}`, fileName)) return true;
		if (await this.downloadFileTo(`https://${processedURL}`, fileName)) return true;
		if (await this.wayback.download(processedURL, fileName)) return true;
		if (queryStringTest.test(processedURL)) {
			processedURL = processedURL.replace(queryStringTest,"");
			if (await this.wayback.download(processedURL, fileName)) return true;
		}
		//console.warn(`Unable to locate ${processedURL}.`);
	}
	*/
	markMissing(postBody) {
		const images = postBody.querySelectorAll("img");
		if (images) {
			for (const image of images) {
				const url = image.getAttribute("src");
				if (!this.assetList.has(url)) {
					if (url.startsWith("http") || url.startsWith("../../")) {
						const extensionRegEx = /(?<extension>\.(gif|png|jpg))(?:\?.*)?$/mi;
						const extensionMatches = extensionRegEx.exec(url);
						let extension = "";
						if (!extensionMatches) {
							// Can't find the file extesion, don't want to mess things up too badly. Bail early.
							return;
						} else {
							extension = extensionMatches.groups.extension;
						}
						const assetFileName = this.generateFileName() + extension;
						this.assetList.set(url, {URL: url, fileName: assetFileName});
					}
				}
			}
		}
	}
	/*
	async getAssets(postBody) {
		const images = postBody.querySelectorAll("img");
		if (images) {
			for (const image of images) {
				const url = image.getAttribute("src");
				if (this.assetList.has(url)) image.setAttribute("src", this.assetList.get(url).fileName);
				else {
					const extensionRegEx = /(?<extension>\.(gif|png|jpg))(?:\?.*)?$/mi;
					const extensionMatches = extensionRegEx.exec(url);
					let extension = "";
					if (!extensionMatches) {
						// Can't find the file extesion, don't want to mess things up too badly. Bail early.
						return;
					} else {
						extension = extensionMatches.groups.extension;
					}
					const assetFileName = this.generateFileName() + extension;
					if (await this.getAsset(url, assetFileName)) {
						image.setAttribute("src", "assets/" + assetFileName);
						this.assetList.set(url, {
							URL: url,
							fileName: assetFileName
						});
					}
				}
			}
		}
	}
	

	findFileMirror(url) {
		let typelessURL = url;
		if (typelessURL.startsWith("http://")) typelessURL = typelessURL.substring(7);
		if (typelessURL.startsWith("https://")) typelessURL = typelessURL.substring(8);
		let mirrorLocation = path.join(config.inputFolder, "../..", typelessURL);
		if (fs.existsSync(mirrorLocation)) return mirrorLocation;
		const wwwFinder = /([\/\\]www\.)/gmi;
		if (wwwFinder.test(typelessURL)) {
			typelessURL = typelessURL.replace(wwwFinder,"/");
			mirrorLocation = path.join(config.inputFolder, "../..", typelessURL);
			if (fs.existsSync(mirrorLocation)) return mirrorLocation;
		}
	}
	*/
	async downloadFileTo(url, filename) {
		const location = path.join(config.outputFolder, "assets", filename);
		let downloadRequest;
		try {
			downloadRequest = await fetch(url);
		} catch (e) {
			//console.log(`Failed to download ${url}: ${e}`);
			return;
		}
		if (!downloadRequest.ok) {
			//console.warn(`Couldn't fetch ${url}. Error code ${downloadRequest.status} Aborting.`);
			return;
		}
		try {
			//console.log(`Fetched ${url}, writing to ${location}...`);
			const fileStream = fs.createWriteStream(location);
			await finished(Readable.fromWeb(downloadRequest.body).pipe(fileStream));
		} catch (e) {
			console.warn(`Error writing to ${location}: ${e}`);
			return;
		}
		//console.log(`---!!! Successfully downloaded ${url} to ${filename} !!!---`);
		return true;
	}
	
	copyFileTo(url, filename) {
		const filePath = path.join(config.inputFolder, url);
		const location = path.join(config.outputFolder, "assets", filename);
		//console.log(`Attempting to copy ${url} to ${filename}...`);
		if (!fs.existsSync(filePath)) {
			//console.warn(`File at ${filePath} doesn't exist. Aborting.`);
			return;
		}
		fs.copyFileSync(filePath, location);
		if (!fs.existsSync(location)) {
			console.warn(`File ${location} does not exist after copying?`)
			return
		} else {
			return true;
		}
	}
	
	generateFileName() {
		const newuuid = crypto.randomUUID();
		const bigValue = BigInt("0x" + newuuid.split("-").join(""));
		return bigValue.toString(36);
	}

	parseProfileCard(card) {
		const userDetails = {};
		if (card.querySelector("a.username")) {
			userDetails.name = card.querySelector("a.username").innerText;
			const userIdRegex = /^[\w\.\-:\/]+\?mode=viewprofile&u=(?<UserId>\d+)($|.*)/;
			if (userIdRegex.exec(card.querySelector("a.username").getAttribute("href"))) userDetails.id = userIdRegex.exec(card.querySelector("a.username").getAttribute("href")).groups.UserId;
			else console.error(`Couldn't parse username from ${card.querySelector("a.username").getAttribute("href")}`);
		} else {
			userDetails.name = card.querySelector("span.username").innerText;
			if (this.idlessUsers.has(userDetails.name)) userDetails.id = this.idlessUsers.get(userDetails.name);
			else userDetails.id = getIdlessUserId(userDetails.name);
		}
		if (card.querySelector("img.avatar")) {
			const avatar = card.querySelector("img.avatar");
			userDetails.avatar = avatar.getAttribute("src");
			userDetails.avatarHeight = avatar.getAttribute("height");
			userDetails.avatarWidth = avatar.getAttribute("width");
		}
		if (card.querySelector("dd.profile-joined")) userDetails.joined = card.querySelector("dd.profile-joined").innerText;
		if (card.querySelector("dd.profile-rank")) userDetails.rank = card.querySelector("dd.profile-rank").lastChild.innerText;
		if (card.querySelector("dd.profile-firstvideo")) userDetails.firstVideo = card.querySelector("dd.profile-firstvideo").lastChild.innerText;
		if (card.querySelector("dd.profile-phpbb_location")) userDetails.location = card.querySelector("dd.profile-phpbb_location").lastChild.innerText;
		return userDetails;
	}
}