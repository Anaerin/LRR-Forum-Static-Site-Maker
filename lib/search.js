import { writeFile } from "./utils.js";

export const index = [];
/* elasticlunr(function () {
	this.addField('page');
	this.addField('userName');
	this.addField('subject');
	this.addField('datePosted');
	this.addField('body');
	this.setRef('page');
	this.saveDocument(false);
});
*/

export async function startImport() {
	//await index.FLUSH();
}

export async function putDocument(document) {
	index.push(...document);
	//await index.PUT(document);
}

export async function writeIndexFile() {
	//const indexExport = await index.EXPORT();
	writeFile("searchIndex.json", JSON.stringify(index));
}