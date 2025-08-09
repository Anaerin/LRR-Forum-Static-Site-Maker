import { sequelize } from "./db/index.js";
import SiteParser  from "./lib/parseSite.js";
import SiteExporter from "./lib/createSite.js";
import { reportProgress, estimateTTC, renderHoldingPage } from "./lib/utils.js";
import WaybackRetriever from "./lib/waybackretrieval.js";
import config from "./config.js";
import progress from "./lib/progress.js";

const parseFiles = true;
const createMirror = true;
const findMissing = true;
const fileParser = new SiteParser(sequelize);
const siteExporter = new SiteExporter(sequelize)

renderHoldingPage();

if (parseFiles) progress.defineTasks(fileParser.Tasks);
if (findMissing) progress.defineTasks([
	{taskName: "populateCache", description: "Download site index from wayback machine"},
	{taskName: "fetchPosts", description: "Fetch missing posts from wayback machine"},
	{taskName: "copyAssets", description: "Copy missing assets from file backup"},
	{taskName: "downloadAssets", description: "Download missing assets from the internet"},
	{taskName: "waybackAssets", description: "Download missing assets from wayback machine"}
]);
if (createMirror) progress.defineTasks(siteExporter.Tasks);
if (parseFiles) {
	await fileParser.parseSite();
};

if (findMissing) {
	const wayback = new WaybackRetriever();
	progress.startTask("populateCache");
	await wayback.prepopulateCDXCache(config.siteBase + "/viewtopic.php");
	progress.updateTask("populateCache", 1, 1);
	progress.completeTask("populateCache");
	progress.startTask("fetchPosts");
	const missingTopics = await sequelize.query(`SELECT Topics.id, Topics.ForumId
			FROM Topics
			WHERE Topics.id NOT IN (
				SELECT Posts.TopicId
				FROM Posts
				GROUP BY Posts.TopicId)`,
			{ type: sequelize.QueryTypes.SELECT});
	let counter = 0;
	for (const topic of missingTopics) {
		progress.updateTask("fetchPosts", counter, missingTopics.length);
		const pageURL=`${config.siteBase}/viewtopic.php?t=${topic.TopicId}`;
		let nextPage = pageURL;
		while (nextPage) {
			console.log(`Fetching ${pageURL} from wayback machine...`);
			const pageContents = await wayback.fetch(nextPage, true, true);
			if (pageContents) {
				if (topic) await topic.destroy();
				nextPage = await fileParser.getNextURL(pageContents, nextPage);
				if (nextPage?.startsWith("./")) nextPage = config.siteBase + nextPage.substring(1);
			} else {
				nextPage = false;
			}
		}
		counter++;
	}
	progress.completeTask("fetchPosts");
	const newAssets = [];
	progress.startTask("copyAssets");
	let missingAssets = await sequelize.models.MissingAsset.findAll({
		where: {
			isCopied: false
		}
	});
	counter = 0;	
	for (const asset of missingAssets) {
		progress.updateTask("copyAssets", counter, missingAssets.length);
		//try copying, that's a neat trick.
		let URL = asset.URL;
		if (URL.startsWith("http://")) URL.substring(7);
		if (URL.startsWith("https://")) URL.substring(8);
		if (URL.startsWith("../../")) URL.substring(6);
		if (fileParser.copyFileTo("../../" + URL, asset.fileName)) newAssets.push(await setAsset(asset));
		else if (fileParser.copyFileTo(URL, asset.fileName)) newAssets.push(await setAsset(asset));
		else {
			asset.isCopied = true;
			await asset.save();
		}
		counter++;
	}
	await sequelize.models.Asset.bulkCreate(newAssets, {
		fields: ["URL", "fileName"],
		updateOnDuplicate: ["URL", "fileName"]
	});
	progress.completeTask("copyAssets");
	newAssets.length = 0;
	counter = 0;
	progress.startTask("downloadAssets");
	missingAssets = await sequelize.models.MissingAsset.findAll({
		where: {
			isDownloaded: false
		}
	});
	for (const asset of missingAssets) {
		progress.updateTask("downloadAssets", counter, missingAssets.length);
		//try downloading, one of them next.
		let URL = asset.URL;
		if (URL.startsWith("http://")) URL.substring(7);
		if (URL.startsWith("https://")) URL.substring(8);
		if (URL.startsWith("../../")) URL.substring(6);
		if (fileParser.downloadFileTo("https://" + URL, asset.fileName)) newAssets.push(await setAsset(asset));
		else if (fileParser.downloadFileTo("http://" + URL, asset.fileName)) newAssets.push(await setAsset(asset))
		else {
			asset.isDownloaded = true;
			await asset.save();
		}
		counter++;
	}
	await sequelize.models.Asset.bulkCreate(newAssets, {
		fields: ["URL", "fileName"],
		updateOnDuplicate: ["URL", "fileName"]
	});
	progress.completeTask("downloadAssets");
	newAssets.length = 0;
	counter = 0;
	progress.startTask("waybackAssets");
	missingAssets = await sequelize.models.MissingAsset.findAll({
		where: {
			isWaybacked: false
		}
	});
	for (const asset of missingAssets) {
		progress.updateTask("waybackAssets", counter, missingAssets.length);
		//What we gonna do right here is go back, way back...
		let URL = asset.URL;
		if (URL.startsWith("http://")) URL.substring(7);
		if (URL.startsWith("https://")) URL.substring(8);
		if (URL.startsWith("../../")) URL.substring(6);
		if (wayback.download(URL, asset.fileName)) newAssets.push(await setAsset(asset));
		else {
			asset.isWaybacked = true;
			await asset.save();
		}
		counter++;
	}
	await sequelize.models.Asset.bulkCreate(newAssets, {
		fields: ["URL", "fileName"],
		updateOnDuplicate: ["URL", "fileName"]
	});
	progress.completeTask("waybackAssets");
}

if (createMirror) {
	await siteExporter.exportForums();
};

reportProgress(false);
async function setAsset(asset) {
	const URL = asset.URL, fileName = asset.fileName;
	await asset.destroy();
	return { URL, fileName };
}