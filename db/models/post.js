"use strict";
import Sequelize, { BOOLEAN } from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class Post extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true
			},
			subject: DataTypes.STRING,
			datePosted: DataTypes.DATE,
			body: DataTypes.TEXT
		}, {sequelize, modelName: "Post", timestamps: false});
	}
	static relation(models) {
		this.belongsTo(models.Topic);
		this.belongsTo(models.User);
	}
}
