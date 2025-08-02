SELECT Users.id, Users.name, Users.avatar, Users.avatarHeight, Users.avatarWidth, Users.location, Users.rank, ? FROM Users.firstVideo, COUNT(Posts.id) AS PostCount FROM Users
INNER JOIN Posts
ON Posts.UserId = Users.id
GROUP BY Posts.UserId
