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
		this.belongsTo(models.Forum, { as: "Parent" , foreignKey: "parentId" });
		this.hasMany(models.Forum, { as: "Children" , foreignKey: "parentId" });
		this.hasMany(models.Topic);
	}
}
