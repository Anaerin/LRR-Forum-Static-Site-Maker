import Sequelize from "sequelize";

// Build our Database instance. You will probably want to change this to something more robust.
export const sequelize = new Sequelize({
	dialect: "sqlite",
	storage: "forum.sqlite",
	logging: false//(...msg) => console.log(msg)
});
sequelize.authenticate();

// Let's have somewhere to store the data models we're using.
let models = {};

// Import all the DB objects

import User from "./models/user.js";
models.User = User;

import Post from "./models/post.js";
models.Post = Post;

import Topic from "./models/topic.js";
models.Topic = Topic;

import Forum from "./models/forum.js";
models.Forum = Forum;

import Asset from  "./models/asset.js"
models.Asset = Asset;

import MissingAsset from "./models/missingasset.js";
models.MissingAsset = MissingAsset;

// Make sure we do this first, to get all the models initialized.
for (let model in models) {
	models[model].init(sequelize);
}

// Only once they're all initialized (and Sequelize knows about them) can we set up the relations.
for (let model in models) {
	if (models[model].relation) models[model].relation(sequelize.models);
}
await sequelize.sync({
	alter: false
});

export default models;
export const Op = Sequelize.Op;
