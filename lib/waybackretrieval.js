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
	async fetchText(url) {
		try {
			const query = await fetch(url);
			if (query.ok) return await query.text();
		} catch (e) {
			console.warn(`Wayback: Unable to fetch text for ${url}: ${e}`);
		}
	}
	async prepopulateCDXCache(url) {
		try {
			let cdxQuery = await this.fetchText(this.constructCDXUri(url, true, false, true));
			try {
				this.processCDXJSON(JSON.parse(cdxQuery));
			} catch(e) {
				console.warn(`Wayback: Unable to parse cdx JSON: ${cdxResult}, ${e}`);
				return;
			}
			while (this.resumeKey) {
				let cdxQuery = await this.fetchText(this.constructCDXUri(url, true, false, true, this.resumeKey));
				try {
					this.processCDXJSON(JSON.parse(cdxQuery));
				} catch(e) {
					console.warn(`Wayback: Unable to parse cdx JSON: ${cdxResult}, ${e}`);
					return;
				}
			}
		} catch(e) {
			console.error(`Wayback: Error fetching ${url}: ${e}`);
			return;
		}
		console.log(`Pre-filled CDX Cache with ${this.cdxCache.size} entries.`);
	}
	constructCDXUri(url, withTimestamp = false, exactMatch = false, showResumeKey = false, resumeKey = "") {
		const args = {...this.cdxArgs};
		if (withTimestamp) args.to = 20250323014429;
		if (exactMatch) args.matchType="exact";
		if (showResumeKey) args.showResumeKey = "true";
		if (resumeKey) args.resumeKey = resumeKey;
		args.url = encodeURIComponent(url);
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
	async fetch(url, useTimestamp = false, exactMatch = false) {
		let processedURL = this.processURL(url);
		if (!this.cdxCache.has(processedURL)) {
			let cdxQuery;
			try {
				console.log(`Wayback: Fetching from CDX: "${this.constructCDXUri(processedURL, useTimestamp, exactMatch)}"`);
				cdxQuery = await fetch(this.constructCDXUri(processedURL, useTimestamp, exactMatch));
			} catch (e) {
				console.warn(`Wayback: Couldn't fetch ${url}: ${e}`);
				return;
			}
			try {
				const cdxResult = await cdxQuery.json();
				this.processCDXJSON(cdxResult);
			} catch (e) {
				console.error(`Error processing CDX JSON for ${url}: ${e}`);
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
		if (!this.cdxCache.has(processedURL)) {
			console.log(`Wayback: No cached result for ${processedURL}`);
			try {
				const cdxURL = this.constructCDXUri(processedURL)
				console.log(`Wayback: Fetching from CDX ${cdxURL}`);
				const cdxQuery = await fetch(cdxURL);
				const cdxResult = await cdxQuery.text();
				if (cdxQuery.ok && cdxResult) {
					try {
						this.processCDXJSON(JSON.parse(cdxResult));
						console.log(`Wayback: CDX now ${this.cdxCache.has(processedURL)?"has":"does not have"} an entry for ${processedURL}`);
					} catch(e) {
						console.warn(`Wayback: Unable to parse cdx JSON: ${cdxResult}, ${e}`);
						return;
					}
				} else {
					console.log(`Error fetching from archive.org - ${cdxQuery.status}: ${cdxQuery.statusText}`);
				}
			} catch(e) {
				console.error(`Wayback: Error fetching ${processedURL}: ${e}`);
				return;
			}
		}
		if (this.cdxCache.has(processedURL)) return this.downloadFromCDX(this.cdxCache.get(processedURL), fileName);
	}
	async downloadFromCDX(cdx, fileName) {
		console.log(`Wayback: Downloading from CDX: ${cdx.timestamp} - ${cdx.original}`);
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
		const cdxRequest = await this.queryCDX(cdx);
		console.log(`Weyback: Fetching page at "https://web.archive.org/web/${cdx.timestamp}/${cdx.original}"`);
		if (cdxRequest?.ok) return await cdxRequest.text();
		else if (cdxRequest) console.warn(`Wayback: Couldn't fetch from CDX: ${cdxRequest.status} (${cdxRequest.statusText})`);
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
			let foundURL;
			let cdxLength = cdx.length;
			if (cdx.length > 2 && cdx[cdx.length - 2].length == 0) {
				//We have a resumeKey.
				cdxLength = cdxLength - 2;
				this.resumeKey = cdx[cdx.length - 1][0];
			} else this.resumeKey = false;
			console.log(`Wayback: Got ${cdxLength} results from CDX.`)
			for (let i=1; i<cdxLength; i++) {
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
				//console.log(`Wayback: Adding to CDX cache: ${foundURL}: ${JSON.stringify(out)}`);
				if (this.cdxCache.has(foundURL) && out.timestamp > this.cdxCache.get(foundURL).timestamp) this.cdxCache.set(foundURL, out);
				else if (!this.cdxCache.has(foundURL)) this.cdxCache.set(foundURL, out);
			}
		} else {
			console.log(`Wayback: CDX returned empty or non-array result: got ${typeof cdx} of length ${cdx?.length}`);
		}
	}
}