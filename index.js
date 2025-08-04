import { sequelize } from "./db/index.js";
import config from "./config.js";
import fs from "fs";
import path from "node:path";
import SiteParser  from "./lib/parseSite.js";
import SiteExporter from "./lib/createSite.js";

const parseFiles = true;
const createMirror = true;
const fileParser = new SiteParser(sequelize);
const siteExporter = new SiteExporter(sequelize)
if (parseFiles) {
	await fileParser.parseSite();
};

if (createMirror) {
	await siteExporter.exportForums();
};