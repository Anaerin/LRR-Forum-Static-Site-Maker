//import fetch from "node-fetch";
import { Readable } from "stream";
import fs from "fs";
import { finished } from "stream/promises";
import config from "../config.js";
import path from "path";
export default class WaybackRetriever {
	archiveFileNameCache = new Map();
	cdxBase = "https://web.archive.org/cdx/search/cdx";
	cdxArgs = {
		matchType: "prefix",
		output: "json",
		filter: "statuscode:200",
		fastLatest: true,
	}
	cdxCache = new Map();
	constructor() {
		// Make it.
	}
	constructCDXUri(url, withTimestamp = false) {
		const args = this.cdxArgs;
		args.url = url;
		if (withTimestamp) args.to = 20250323014429;
		const argArray = [];
		for (const arg of Object.getOwnPropertyNames(args)) {
			argArray.push(`${arg}=${args[arg]}`);
		}
		return `${this.cdxBase}?${argArray.join("&")}`;
	}
	processURL(url) {
		let processedURL = url;
		// strip out http(s) header.
		if (processedURL.startsWith("http://")) processedURL = processedURL.substring(7);
		if (processedURL.startsWith("https://")) processedURL = processedURL.substring(8);
		return processedURL;
	}
	async fetch(url, useTimestamp = false) {
		let processedURL = this.processURL(url);
		if (!this.cdxCache.has(processedURL)) {
			const cdxQuery = await fetch(this.constructCDXUri(processedURL, useTimestamp));
			try {
				const cdxResult = await cdxQuery.json();
				this.processCDXJSON(cdxResult);
			} catch (e) {
				console.error(`Error processig CDX JSON for ${url}: ${e}`);
				return;
			}
		}
		if (this.cdxCache.has(processedURL)) return this.fetchFromCDX(this.cdxCache.get(processedURL));
	}
	async download(url, fileName) {
		let processedURL = this.processURL(url);
		if (this.archiveFileNameCache.has(processedURL)) {
			fs.copyFileSync(path.join(config.outputFolder, "assets", this.archiveFileNameCache.get(processedURL)), path.join(config.outputFolder, "assets", fileName));
			return true;
		}
		let fetchedCDX;
		if (!this.cdxCache.has(processedURL)) {
			//console.log(`Wayback: No cached result for ${url}`);
			try {
				const cdxQuery = await fetch(this.constructCDXUri(processedURL));
				const cdxResult = await cdxQuery.text();
				if (cdxQuery.ok && cdxResult) {
					try {
						fetchedCDX = this.processCDXJSON(JSON.parse(cdxResult));
					} catch(e) {
						console.warn(`Wayback: Unable to parse cdx JSON: ${cdxResult}, ${e}`);
						return;
					}
					if (fetchedCDX) return this.downloadFromCDX(fetchedCDX, fileName);
				} else {
					console.log(`Error fetching from archive.org - ${cdxQuery.status}: ${cdxQuery.statusText}`);
				}
			} catch(e) {
				console.error(`Wayback: Error fetching ${processedURL}: ${e}`);
				return;
			}
		} else {
			return this.downloadFromCDX(this.cdxCache.get(processedURL), fileName);
		}
	}
	async downloadFromCDX(cdx, fileName) {
		//console.log(`Downloading from CDX: ${cdx.timestamp} - ${cdx.original}`);
		const cdxRequest = await this.queryCDX(cdx);
		const location = path.join(config.outputFolder, "assets", fileName);
		const fileStream = fs.createWriteStream(location);
		try {
			await finished(Readable.fromWeb(cdxRequest.body).pipe(fileStream));
		} catch (e) {
			console.warn(`Wayback: Error writing to ${location}: ${e}`);
			return;
		}
		this.archiveFileNameCache.set(this.processURL(cdx.original), fileName);
		return true;
	}
	async fetchFromCDX(cdx) {
		const cdxRequest = await queryCDX(cdx);
		return await cdxRequest.body
	}
	async queryCDX(cdx) {
		const url = `https://web.archive.org/web/${cdx.timestamp}/${cdx.original}`;
		let downloadRequest;
		try {
			downloadRequest = await fetch(url);
		} catch(e) {
			console.error(`Wayback: Couldn't download from ${url}: ${e}`);
			return;
		}
		if (!downloadRequest.ok) {
			console.warn(`Wayback: Couldn't fetch ${url}. Error code ${downloadRequest.status}: ${downloadRequest.statusText} Aborting.`);
			return;
		}
		return downloadRequest;
	}
	processCDXJSON(cdx) {
		if (Array.isArray(cdx) && cdx.length>0) {
			const key = cdx[0];
			let output;
			let foundURL;
			for (let i=1; i<cdx.length; i++) {
				const out = {};
				for (let k=0;k<key.length;k++) {
					out[key[k]] = cdx[i][k];
					if (key[k] == "original") {
						// remove port numbers, if applicable
						out.strippedURL = out.original.replace(":80","");
						out.strippedURL = out.strippedURL.replace(":80","");
						out.strippedURL = out.strippedURL.replace(":443","");
						out.strippedURL = out.strippedURL.replace("http://","");
						out.strippedURL = out.strippedURL.replace("https://","");
						// remove session id from querystring
						const sidRemover = /([\&\?]sid=[0-9a-f]{32})/i;
						out.strippedURL = out.strippedURL.replace(sidRemover,"");
						foundURL = out.strippedURL;
					}
				}
				//console.log(`Adding to CDX cache: ${foundURL}: ${JSON.stringify(out)}`);
				if (!output || out.timestamp > output.timestamp) output = out;
			}
			if (output) {
				this.cdxCache.set(foundURL, output);
				return output;
			}
		} else {
			//console.log(`CDX returned empty or non-array result: got ${typeof cdx} of length ${cdx?.length}`);
		}
	}
}