import fs from "fs";
import path from "path";
import config from "../config.js";
import templates from "../templates/index.js";
import { start } from "repl";

let idlessUserID = 100000;
const idlessUsers = new Map();
let currentProgress = {};
let waitingForWrite = false;
let timeout;
export function createLink(page, parameters, hash="") {
	let params = [];
	const keys = ["f", "t", "p"];
	if (parameters instanceof Map || parameters instanceof Set) {
		keys.forEach((key) => {
			if (parameters.has(key)) params.push([key, parameters.get(key)]);
		})
	} else if (parameters instanceof Array) {
		keys.forEach((key) => {
			if (getFromArray(parameters, key)) params.push(getFromArray(parameters, key));
		})
	} else if (parameters instanceof Object) {
		keys.forEach((key) => {
			if (parameters.hasOwnProperty(key)) params.push([key, parameters[key]]);
		})
	}

	//flatten with filename-safe sanity check
	params = params.map((entry) => {
		return entry.join("=").replace(/^[^\w_=-]+$/g,"-");
	})
	return `${page}-${[params.join('_')]}.htm${hash}`;
}
function getFromArray(array, key) {
	return array.find((value) => {
		if (value[0] = key) return value;
	});
}
export function getIdlessUserId(name) {
	let userId;
	if (!idlessUsers.has(name)) {
		userId = idlessUserID++;
		idlessUsers.set(name, userId);
	} else {
		userId = idlessUsers.get(name);
	}
	return userId;
}
export function getIdlessUserCount() {
	return idlessUsers.size;
}
export function writeFile(filename, contents) {
	const resolvedPath = path.resolve(config.outputFolder, filename);
	try {
		fs.writeFileSync(resolvedPath, contents, { flush: true, encoding: "utf8" }, (err) => {
			console.error(`Error writing file ${filename} to ${resolvedPath}: ${err}`);
		});
	} catch(e) {
		console.log(`Couldn't write to progress file: ${e}`);
	}
}
export function moveFile(from, to) {
	const resolvedFrom = path.resolve(config.outputFolder, from);
	const resolvedTo = path.resolve(config.outputFolder, to);
	fs.renameSync(resolvedFrom, resolvedTo);
}
export function deleteFile(fileName) {
	const resolvedFileName = path.resolve(config.outputFolder, fileName);
	fs.rmSync(resolvedFileName);
}
export function estimateTTC(startTime, progress, total) {
	const elapsedTime = Date.now() - startTime;
	const remainAmt = total - progress;
	const timePer = elapsedTime / (progress + 1); // +1 to avoid a divide-by-zero;
	const eta = timePer * remainAmt;
	let timeParts = Math.floor(eta / 1000);
	let out = "";
	out = `${padNumber(timeParts % 60,2)} seconds remaining`
	timeParts = Math.floor(timeParts / 60);
	if (timeParts > 0) {
		out = `${padNumber(timeParts % 60,2)} minutes, ${out}`;
		timeParts = Math.floor(timeParts / 60);
		if (timeParts > 0) {
			out = `${padNumber(timeParts % 24,2)} hours, ${out}`;
			timeParts = Math.floor(timeParts / 24);
			if (timeParts > 0) {
				out = `${timeParts} days, ${out}`;
			}
		}
	}
	return out;
}
function padNumber(num, digits) {
	const padding = "0".repeat(digits);
	const paddedNumber = padding + Math.floor(num.toString(10));
	return paddedNumber.substring(paddedNumber.length - digits);
}
export function reportProgress(task, startTime, position, total) {
	if (task) {
		const lastUpdate = currentProgress.lastUpdate;
		currentProgress = {
			task, 
			lastUpdate: Date.now(),
			position,
			total, 
			startTime
		};
		if (!waitingForWrite) {
			if (lastUpdate+10000 < Date.now()) writeProgress();
			else {
				waitingForWrite = true;
				timeout = setTimeout(writeProgress, 10000)
			}
		}
	} else {
		clearTimeout(timeout);
		writeFile("progress.json", "{}");
	}
}
function writeProgress() {
	if (currentProgress.startTime && currentProgress.position && currentProgress.total) {
		currentProgress.eta = estimateTTC(currentProgress.startTime, currentProgress.position, currentProgress.total);
	}
	writeFile("progress.json", JSON.stringify(currentProgress));
	waitingForWrite = false;
}
export function renderHoldingPage() {
	writeFile("index.htm", templates.holdingPage({
		title: "Site generation in progress...",
		pageContent: "<h1>Site creation in progress, please wait...</h1>"
	}));
}