import { createLink, deleteFile, moveFile, reportProgress, writeFile } from "./utils.js";
import templates from "../templates/index.js";
import config from "../config.js";
import { parse } from "node-html-parser";
export default class siteExporter {
	forumsByParent = new Map();
	forumsWithTopics = [];
	foraById = new Map();
	forumParts = new Map();
	users = new Map();
	errors = [];
	assets = new Map();
	Tasks = [
		{taskName: "writeForums", description: "Write forum pages"},
		{taskName: "writeTopics", description: "Write topic index pages"},
		{taskName: "writePosts", description: "Write post pages"}
	];
	constructor(db) {
		this.db = db;
		this.writeFile = writeFile;
		this.buildAssets().then();
	}
	missingPages = [];
	async reset() {
		this.forumsByParent.clear();
		this.forumsWithTopics.length = 0;
		this.foraById.clear();
		this.forumParts.clear();
		this.users.clear();
		await this.buildAssets();
	}
	async buildForumTree() {
		const forumIndex = await this.db.query(`
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
				type: this.db.QueryTypes.SELECT,
		});
		// We have a flat interpretation of the forum structure, build it into a tree (ish)
		forumIndex.forEach((forum) => {
			if (this.forumsByParent.has(forum.parentId)) this.forumsByParent.set(forum.parentId, [...this.forumsByParent.get(forum.parentId), forum]);
			else this.forumsByParent.set(forum.parentId, [ forum ]);
			this.foraById.set(forum.id, forum);
			if (forum.TopicCount > 0) {
				this.forumsWithTopics.push(forum.id);
			}
		});
	}
	async renderForumPages(finishedFindingMissingAssets = false) {
		const rootCategories = this.forumsByParent.get(null);
		const forumList = await this.renderForumList(rootCategories, true);
		const forumRenderValues = {
			forumPage: forumList,
			title: "Index page"
		}
		if (!finishedFindingMissingAssets) forumRenderValues.note = `<h1>Rendered from incomplete backup, please wait while missing assets are found where possible</h1>`;
		const forumRender = templates.forum(forumRenderValues);
		this.writeFile("index_forum.htm", forumRender);
		console.log(`Written index.htm`);
		this.forumParts.forEach((val, key) => {
			const forumPage = templates.forum({
				forumPage: templates.categoryline({id: key, name: val.name, childForums: val.contents}),
				title: val.name
			});
			const pageLink = createLink("forum", {f: key});
			this.writeFile(pageLink, forumPage);
			console.log(`Written ${pageLink}`);
		});
	}
	
	async renderTopicPages(forumId) {
		const forum = this.foraById.get(forumId);
		const breadcrumbs = this.buildBreadcrumbs(forumId);
		console.log(`Querying for topics for forum ${forum.name}...`);
		const topics = await this.db.query(`
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
				type: this.db.QueryTypes.SELECT
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
			this.writeFile(pageLink, pageContents);
			topicPageContents = "";
		}
	}
	
	buildBreadcrumbs(forumId) {
		const breadcrumbs = [];
		let currentForumId = forumId;
		while (currentForumId) {
			if (this.forumsWithTopics.includes(currentForumId)) breadcrumbs.push({url: createLink("topics", {f: currentForumId}), title: this.foraById.get(currentForumId).name});
			else breadcrumbs.push({url: createLink("forum", {f: currentForumId}), title: this.foraById.get(currentForumId).name});
			currentForumId = this.foraById.get(currentForumId).parentId;
		}
		breadcrumbs.reverse();
		return breadcrumbs;
	}

	async buildUserMap() {
		const userArray = await this.db.query(`
			SELECT Users.id, Users.name, Users.avatar, Users.avatarHeight, Users.avatarWidth, Users.location, Users.rank, Users.firstVideo, COUNT(Posts.id) AS PostCount, Users.signature FROM Users
			INNER JOIN Posts
			ON Posts.UserId = Users.id
			GROUP BY Posts.UserId
		`, {
			type: this.db.QueryTypes.SELECT,
			raw: true
		});
		userArray.forEach((user) => {
			this.users.set(user.id, user);
		});
	}

	async buildAssets() {
		this.assets.clear();
		const assets = await this.db.models.Asset.findAll({raw: true});
		for (const asset of assets) {
			this.assets.set(asset.URL, asset.fileName);
		}
	}
	async exportForums() {
		const forumCounts = await this.db.models.Forum.count();
		if (forumCounts < 1) {
			console.error(`Unable to find any forums to render. Do you need to parse the forum backup?`);
			return;
		}
		await this.buildForumTree();
		this.missingPages.length = 0;
		await this.renderForumPages();
		const startTime = Date.now();
		let counter = 0;
		for (const forumId of this.forumsWithTopics) {
			await this.renderTopicPages(forumId);
			await this.buildUserMap();
			const breadcrumbs = this.buildBreadcrumbs(forumId);
			let postTopics;
			try {
				postTopics = await this.db.models.Topic.findAll({ where: {
					forumId: forumId
				}});
			} catch (e) {
				console.error(`Unable to fetch topics: ${e}`);
			}
			counter = 0;
			for (const topic of postTopics) {
				reportProgress(`Writing Topics for forum ${this.foraById.get(forumId).name}`, startTime, counter, postTopics.length);
				counter++;
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
								user: this.users.get(post.UserId)
							};
							const postBody = parse(post.body);
							for (const image of postBody.querySelectorAll("img")) {
								let URL = image.getAttribute("src");
								if (URL.startsWith("http://")) URL.substring(7);
								if (URL.startsWith("https://")) URL.substring(8);
								if (URL.startsWith("../../")) URL.substring(6);
								if (this.assets.has(URL)) image.setAttribute("src", this.assets.get("URL"));
							}
							postDetails.body = postBody.toString();
							postLines.push(templates.postline(postDetails));
						}
						let pageLink = "";
						const threadLink = createLink("posts", {f: forumId, t: topic.id});
						if (page > 0) pageLink = createLink("posts", {f: forumId, t: topic.id, p: page});
						else pageLink = threadLink
						let pageContents = templates.posts({
							breadcrumbs: breadcrumbs,
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
						this.writeFile(pageLink, pageContents);
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
					this.errors.push({reason: "Missing Topic", page: threadLink});
					this.writeFile(threadLink, pageContents);
				}
			}
		};
		deleteFile("index.htm");
		moveFile("index_forum.htm","index.htm");
		console.log(`Finished processing.`);
	}

	reportErrors() {
		console.log(`Encountered ${this.errors.length} errors this run:`);
		for (const error of this.errors) {
			if (error.errObj) console.error(`${error.page}: ${error.reason} (${error.errObj})`);
			else console.error(`${error.page}: ${error.reason}`);
		}
	}

	async renderForumList(currentForum, isCategory) {
		let out = "";
		for (const forum of currentForum) {
			let childForums = "";
			if (this.forumsByParent.has(forum.id)) {
				childForums = await this.renderForumList(this.forumsByParent.get(forum.id), false);
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
				this.forumParts.set(forum.id, {name: forum.name, contents: childForums});
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
}