const config = {
	inputFolder: "T:\\workingForum\\LRR Forums\\loadingreadyrun.com\\forum",
	outputFolder: "L:/",
	staticFolder: "static/",
	topicsPerPage: 50,
	postsPerPage: 25,
	siteBase: "https://loadingreadyrun.com/forum",
	sqlSetup: {
		dialect: "mysql",
		host: "hostname",
		username: "lrrForum",
		password: "Password Goes Here, obviously",
		database: "lrrForum"
	}
}
export default config