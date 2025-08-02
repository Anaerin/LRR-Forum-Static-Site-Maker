"use strict";
import Sequelize from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class User extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true
			},
			name: DataTypes.STRING,
			avatar: DataTypes.STRING,
			avatarHeight: DataTypes.INTEGER,
			avatarWidth: DataTypes.INTEGER,
			location: DataTypes.STRING,
			rank: DataTypes.STRING,
			firstVideo: DataTypes.STRING,
			joined: DataTypes.DATE,
			signature: DataTypes.TEXT
		}, {sequelize, modelName: "User", timestamps: false});
	}
	static relation(models) {
		this.hasMany(models.Post);
		this.hasMany(models.Topic);
	}
}
