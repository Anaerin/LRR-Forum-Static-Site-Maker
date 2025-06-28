import fs from "fs";
import handlebars from "handlebars";

handlebars.registerHelper("paginationLink", (text, options) => {
	const linkMap = new Map();
	let out = "";
	Object.keys(options.hash).forEach(key => {
		if (options.hash[key]) linkMap.set(key, options.hash[key]);
	});
	if (linkMap.has(topicId)) {
		if (linkMap.has("pageNumber")) out = `./viewtopic-f=${linkMap.get("forumId")}-t=${linkMap.get("topicId")}-p=${linkMap.get("pageNumber")}.htm`;
		else out = `./viewtopic-f=${linkMap.get("forumId")}-t=${linkMap.get("topicId")}.htm`;
	} else {
		if (linkMap.has("pageNumber")) out = `./viewforum-f=${linkMap.get("forumId")}-p=${linkMap.get("pageNumber")}.htm`;
		else out= `./viewforum-f=${linkMap.get("forumId")}.htm`
	}
	return new handlebars.SafeString(out);
});

let partialFiles = fs.readdirSync("./partials");
partialFiles.forEach(file => {
	if (file.endsWith(".hbs")) {
		let template = handlebars.compile(fs.readFileSync("./partials/" + file));
		handlebars.registerPartial(file.substring(0,file.length - 4), template);
	}
});

const pageTemplate = handlebars.compile(fs.readFileSync("templates/page.hbs"));

for (template in templates) {
	let templateString = 
	templates[template].generate = handlebars.compile(templateString);
}

export default templates;