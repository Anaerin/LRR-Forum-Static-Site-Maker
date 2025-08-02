import fs, { link } from "fs";
import handlebars from "handlebars";
const templates = {};
import { createLink } from "../lib/utils.js";
import { json } from "sequelize";
const timeZone = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "Etc/GMT-2",
	hour12: false
});

handlebars.registerHelper("formatDateTime", function (text, options) {
	if (text) {
		const dateObj = new Date(text);
		return timeZone.format(dateObj);
	} else {
		return "Invalid Date?";
	}
});

handlebars.registerHelper("paginationLink", (text, options) => {
	const linkMap = new Map();
	let out = "";
	Object.keys(options.hash).forEach(key => {
		if (options.hash[key]) linkMap.set(key, options.hash[key]);
	});
	const queryString = new Map();
	queryString.set("f", linkMap.get("forumId"));
	if (linkMap.has("topicId")) queryString.set("t", linkMap.get("topicId"));
	if (linkMap.has("pageNumber") && linkMap.get("pageNumber") > 1) queryString.set("p", linkMap.get("pageNumber"));
	out = createLink(text, queryString);
	return new handlebars.SafeString(out);
});

handlebars.registerHelper("paginationBlock", (text, options) => {
	let out = "<ul>";
	const hash = options.hash;
	const page = hash.page;
	const pages = hash.pages;
	const forumId = hash.forumId;
	const topicId = hash.topicId;
	const linkFilename = text;
	const queryString = new Map();
	if (pages > 1) { // If we need to display pagination, do so.
		if (forumId) queryString.set("f", forumId);
		if (topicId) queryString.set("t", topicId);
		queryString.set("p", page - 1);
		if (page > 0 && hash.nextprev == true) out += `<li class="previous"><a href="${createLink(linkFilename, queryString)}" role="button" rel="prev">Previous</a></li>`;
		if (page >=0) {
			const offset = 2;
			for (let i=0; i <= pages; i++) {
				if (i == 0 || (page - offset <= i && page + offset >= i) || i == page || i == pages) {
					out += makePaginationLink(linkFilename, forumId, topicId, page, i);
				} else if (i == page - (offset + 1) || i == page + (offset + 1)) {
					out += `<li class="ellipsis" role="separator"><span>…</span></li>`;
				}
			}
		} else {
			if (pages <=5) {
				for (let i = 0; i<=pages; i++) { //We have no page and there's less than 5 pages. Special case it.
					out += makePaginationLink(linkFilename, forumId, topicId, page, i);
				}
			} else {
				out += makePaginationLink(linkFilename, forumId, topicId, page, 0);
				out += `<li class="ellipsis" role="separator"><span>…</span></li>`;
				for (let i = pages-4; i<=pages; i++) { //Note, -4 because we always have a link to the last page.
					out += makePaginationLink(linkFilename, forumId, topicId, page, i);
				}
			}
		}
		if (page >= 0 && page < pages && hash.nextprev == true) {
			queryString.set("p", page + 1);
			out += `<li class="next"><a href="${createLink(linkFilename, queryString)}" role="button" rel="next">Next</a></li>`;
		}
		out += `</ul>`;
		return new handlebars.SafeString(out);
	}
});

function makePaginationLink(linkFilename, forumId, topicId, pageNumber, currentPage) {
	if (pageNumber == currentPage) return `<li class="active"><span>${currentPage + 1}</span></li>`;
	else {
		const qs = new Map();
		if (forumId) qs.set("f", forumId);
		if (topicId) qs.set("t", topicId);
		if (currentPage > 0) qs.set("p", currentPage);
		return `<li><a href="${createLink(linkFilename, qs)}" role="button">${currentPage + 1}</a></li>`;
	}
}

let partialFiles = fs.readdirSync("./templates/partials");
partialFiles.forEach(file => {
	if (file.endsWith(".hbs")) {
		let template = handlebars.compile(fs.readFileSync("./templates/partials/" + file, { encoding: "utf8" }));
		handlebars.registerPartial(file.substring(0, file.length - 4), template);
		templates[file.substring(0, file.length - 4)] = template;
	}
});

let templateFiles = fs.readdirSync("./templates");
templateFiles.forEach(file => {
	if (file.endsWith(".hbs")) {
		const template = handlebars.compile(fs.readFileSync("./templates/" + file, { encoding: "utf8" }));
		templates[file.substring(0, file.length - 4)] = template;
	}
});

export default templates;