import { createLink } from "./utils.js";
import templates from "../templates/index.js";
import config from "../config.js";
export default class siteExporter {
	forumsByParent = new Map();
	forumsWithTopics = [];
	foraById = new Map();
	forumParts = new Map();
	users = new Map();
	errors = [];
	missingPages = [];
	constructor(db) {
		this.db = db;
	}
	writeFile(filename, contents) {
		const resolvedPath = path.resolve(config.outputFolder, filename);
		fs.writeFileSync(resolvedPath, contents, { flush: true, encoding: "utf8" }, (err) => {
			console.error(`Error writing file ${filename} to ${resolvedPath}: ${err}`);
		});
	}

	async buildForumTree() {
		const forumIndex = await db.query(`
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
				type: db.QueryTypes.SELECT,
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
	async renderForumPages() {
		const rootCategories = this.forumsByParent.get(null);
		const forumList = await this.renderForumList(rootCategories, true);
		const forumRender = templates.forum({
			forumPage: forumList,
			title: "Index page"
		});
		this.writeFile("index.htm", forumRender);
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
		console.log(`Querying for topics for forum ${foraById.get(forumId).name}...`);
		const topics = await db.query(`
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
				type: db.QueryTypes.SELECT
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
		const userArray = await db.query(`
			SELECT Users.id, Users.name, Users.avatar, Users.avatarHeight, Users.avatarWidth, Users.location, Users.rank, Users.firstVideo, COUNT(Posts.id) AS PostCount, Users.signature FROM Users
			INNER JOIN Posts
			ON Posts.UserId = Users.id
			GROUP BY Posts.UserId
		`, {
			type: QueryTypes.SELECT,
			raw: true
		});
		userArray.forEach((user) => {
			this.users.set(user.id, user);
		});
	}
	async exportForums() {
		const forumCounts = await db.models.Forum.count();
		if (forumCounts < 1) {
			console.error(`Unable to find any forums to render. Do you need to parse the forum backup?`);
			return;
		}
		await this.buildForumTree();
		await this.renderForumPages();
		for (const forumId of this.forumsWithTopics) {
			await this.renderTopicPages();
			await this.buildUserMap();
			
			let postTopics;
			try {
				postTopics = await db.models.Topic.findAll({ where: {
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
					this.missingPages.push({
						ForumId: forumId,
						TopicId: topic.id
					});
				}
			}
		};
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
}