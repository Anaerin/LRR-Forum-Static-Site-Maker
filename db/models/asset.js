"use strict";
import Sequelize from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class Asset extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true,
				autoIncrement: true,
				allowNull: false
			},
			URL: DataTypes.STRING,
			fileName: DataTypes.STRING,
			isFetched: {
				type: DataTypes.BOOLEAN,
				defaultValue: false
			}
		}, {sequelize, modelName: "Asset", timestamps: false});
	}
}
