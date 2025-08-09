"use strict";
import Sequelize from "sequelize";

const Model = Sequelize.Model;
const DataTypes = Sequelize.DataTypes;

export default class MissingAsset extends Model {
	static init(sequelize) {
		super.init({
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true
			},
			URL: DataTypes.STRING,
			fileName: DataTypes.STRING,
			isCopied: {
				type: DataTypes.BOOLEAN,
				defaultValue: false
			},
			isDownloaded: {
				type: DataTypes.BOOLEAN,
				defaultValue: false
			},
			isWaybacked: {
				type: DataTypes.BOOLEAN,
				defaultValue: false
			}
		}, {sequelize, modelName: "MissingAsset", timestamps: false});
	}
}
