"use strict";
import Sequelize from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class Forum extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true
			},
			name: DataTypes.STRING,
			description: DataTypes.STRING
		}, {sequelize, modelName: "Forum", timestamps: false});
	}
	static relation(models) {
		this.belongsTo(models.Forum, { as: "parent" });
		this.hasMany(models.Forum, { as: "child" });
		this.hasMany(models.Topic);
	}
}
