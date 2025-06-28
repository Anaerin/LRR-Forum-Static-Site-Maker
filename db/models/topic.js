"use strict";
import Sequelize from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class Topic extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true
			},
			name: DataTypes.STRING,
			dateCreated: DataTypes.DATE,
			isAnnouncement: {
				type: DataTypes.BOOLEAN,
				defaultValue: false
			}
		}, {sequelize, modelName: "Topic", timestamps: false});
	}
	static relation(models) {
		this.belongsTo(models.Forum);
		this.belongsTo(models.User);
		this.hasMany(models.Post);
	}
}
