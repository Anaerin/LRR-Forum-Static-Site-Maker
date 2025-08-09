import templates from "../templates/index.js";
import path from "path";
import fs from "fs";
import config from "../config.js";

class Progress {
	tasks = new Map();
	timeOut;
	lastUpdated;
	timerStarted = false;
	constructor() {
		this.renderHoldingPage();
	}
	renderHoldingPage() {
		const resolvedPath = path.resolve(config.outputFolder, "index.htm");
		try {
			fs.writeFileSync(
				resolvedPath, 
				templates.holdingPage({
					title: "Site generation in progress...",
					pageContent: "<h1>Site creation in progress, please wait...</h1>"
				}), 
				{ flush: true, encoding: "utf8" }, 
				(err) => {
					console.error(`Error writing holding page to ${resolvedPath}: ${err}`);
				}
			);
		} catch(e) {
			console.warn(`Couldn't write to holding page: ${e}`);
		}
	}

	defineTask(taskName, description) {
		if (this.tasks.has(taskName)) {
			const taskValues = this.tasks.get(taskName);
			taskValues.taskName = taskName;
			taskValues.description = description;
			this.tasks.set(taskName, taskValues);
		} else {
			this.tasks.set(taskName, { taskName, description });
		}
	}
	
	defineTasks(taskList) {
		taskList.forEach((task) => {
			this.defineTask(task.taskName, task.description);
		});
	}
	
	startTask(taskName) {
		if (this.tasks.has(taskName) && !this.tasks.get(taskName).whenStarted && !this.tasks.get(taskName).completed) {
			const taskValues = this.tasks.get(taskName);
			taskValues.whenStarted = Date.now();
			this.tasks.set(taskName, taskValues);
		}
	}
	
	completeTask(taskName) {
		if (this.tasks.has(taskName) && this.tasks.get(taskName).whenStarted) {
			const taskValues = this.tasks.get(taskName);
			taskValues.completed = true;
			delete taskValues.whenStarted;
			delete taskValues.eta;
			this.tasks.set(taskName, taskValues);
		}
	}

	updateTask(taskName, progress, total) {
		if (this.tasks.has(taskName) && this.tasks.get(taskName).whenStarted) {
			const taskValues = this.tasks.get(taskName);
			taskValues.progress = progress;
			taskValues.total = total;
			if (taskValues.whenStarted && !taskValues.completed) taskValues.eta = " - " + this.estimateTTC(taskValues.whenStarted, taskValues.progress, taskValues.total);
			this.tasks.set(taskName, taskValues);
			if (!this.timerStarted) {
				if ((this.lastUpdated + 5000) < Date.now()) {
					this.timerStarted = true;
					this.timeOut = setTimeout(this.writeUpdate.bind(this), 5000);
				} else {
					this.writeUpdate();
				}
			}
		}
	}

	writeUpdate() {
		const resolvedPath = path.resolve(config.outputFolder, "progress.json");
		let out = [];
		this.tasks.forEach((value, key) => {
			out.push(value);
		});
		try {
			fs.writeFileSync(resolvedPath, JSON.stringify(out), { flush: true, encoding: "utf8" }, (err) => {
				console.error(`Error writing file progress.json to ${resolvedPath}: ${err}`);
			});
		} catch(e) {
			console.log(`Couldn't write to progress file: ${e}`);
		}
		this.lastUpdated = Date.now();
		if (this.timerStarted) this.timerStarted = false;
	}

	estimateTTC(startTime, progress, total) {
		const elapsedTime = Date.now() - startTime;
		const remainAmt = total - progress;
		const timePer = elapsedTime / (progress + 1); // +1 to avoid a divide-by-zero;
		const eta = timePer * remainAmt;
		let timeParts = Math.floor(eta / 1000);
		let out = "";
		if (timeParts > 9) out = `${this.padNumber(timeParts % 60,2)} seconds remaining`
		else out = `${timeParts} seconds remaining`
		timeParts = Math.floor(timeParts / 60);
		if (timeParts > 0) {
			if (timeParts > 9) out = `${this.padNumber(timeParts % 60,2)} minutes, ${out}`;
			else out = `${timeParts} minutes, ${out}`;
			timeParts = Math.floor(timeParts / 60);
			if (timeParts > 0) {
				if (timeParts > 9) out = `${this.padNumber(timeParts % 24,2)} hours, ${out}`;
				else out = `${timeParts} hours, ${out}`;
				timeParts = Math.floor(timeParts / 24);
				if (timeParts > 0) {
					out = `${timeParts} days, ${out}`;
				}
			}
		}
		return out;
	}
	padNumber(num, digits) {
		const padding = "0".repeat(digits);
		const paddedNumber = padding + Math.floor(num.toString(10));
		return paddedNumber.substring(paddedNumber.length - digits);
	}
}

export default new Progress();