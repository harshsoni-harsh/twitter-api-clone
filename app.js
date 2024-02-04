const express = require('express')
const sqlite3 = require('sqlite3')
const {open} = require('sqlite')
const bcrypt = require('bcrypt')
const path = require('path')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

let db = null

const initializeDbAndRunServer = async () => {
  try {
    db = await open({
      filename: path.join(__dirname, 'twitterClone.db'),
      driver: sqlite3.Database,
    })
    app.listen(3000)
  } catch (e) {
    console.log(e)
    process.exit(1)
  }
}

initializeDbAndRunServer()

function authenticateToken(req, res, next) {
  let jwtToken
  let authHeader = req.headers.authorization
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (!jwtToken) {
    res.status(401).send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, '$uper#$@secreteK%y2', async (error, payload) => {
      if (error) {
        res.status(401).send('Invalid JWT Token')
      } else {
        req.username = payload.username
        req.user_id = payload.user_id
        next()
      }
    })
  }
}

app.post('/register', async (req, res) => {
  let {username, password, gender, name} = req.body
  let userCheckQuery = `
        SELECT password FROM user WHERE username = '${username}'
    `
  let dbPassword = await db.get(userCheckQuery)
  if (dbPassword) {
    res.status(400).send('User already exists')
  } else if (password.length < 6) {
    res.status(400).send('Password is too short')
  } else {
    let hashedPassword = await bcrypt.hash(password, 10)
    let registerQuery = `
      INSERT INTO
        user (username, password, gender, name)
      VALUES ('${username}', '${hashedPassword}', '${gender}', '${name}')
    `
    await db.run(registerQuery)
    res.send('User created successfully')
  }
})

app.post('/login', async (req, res) => {
  let {username, password} = req.body
  let userCheckQuery = `
        SELECT password, user_id FROM user WHERE username = '${username}'
    `
  let dbPassword = await db.get(userCheckQuery)
  if (dbPassword) {
    let isCorrect = await bcrypt.compare(password, dbPassword.password)
    if (isCorrect) {
      let user_id = dbPassword.user_id
      let payload = {username, user_id}
      let jwtToken = jwt.sign(payload, '$uper#$@secreteK%y2')
      res.send({jwtToken})
    } else {
      res.status(400).send('Invalid password')
    }
  } else {
    res.status(400).send('Invalid user')
  }
})

app.get('/user/tweets/feed', authenticateToken, async (req, res) => {
  let {user_id} = req
  let tweetQuery = `
    SELECT
      joined.username as username,
      tweet,
      date_time AS dateTime
    FROM
      (tweet INNER JOIN user on user.user_id = tweet.user_id) as joined INNER JOIN follower on joined.user_id = follower.following_user_id
    WHERE
      follower_user_id = ${user_id}
    GROUP BY joined.tweet_id
    ORDER BY date_time DESC
    LIMIT 4
  `
  let tweets = await db.all(tweetQuery)
  res.send(tweets)
})

app.get('/user/following', authenticateToken, async (req, res) => {
  let {username} = req
  let tweetQuery = `
    SELECT DISTINCT
      followerUser.name as name
    FROM
      (follower inner join user on user.user_id = follower.follower_user_id) as followingUser
      inner join user as followerUser on followerUser.user_id = followingUser.following_user_id
    WHERE
      followingUser.username = '${username}'
  `
  let following = await db.all(tweetQuery)
  res.send(following)
})

app.get('/user/followers', authenticateToken, async (req, res) => {
  let {username} = req
  let tweetQuery = `
    SELECT DISTINCT
      followingUser.name as name
    FROM
      (follower inner join user on user.user_id = follower.follower_user_id) as followingUser
      inner join user as followerUser on followerUser.user_id = followingUser.following_user_id
    WHERE
      followerUser.username = '${username}'
  `
  let followers = await db.all(tweetQuery)
  res.send(followers)
})

app.get('/tweets/:tweetId', authenticateToken, async (req, res) => {
  let {username, user_id} = req
  let {tweetId} = req.params
  let tweetQuery = `
    SELECT
      *
    FROM 
      tweet
    WHERE
      tweet_id = ${tweetId}
  `
  let tweet = await db.get(tweetQuery)
  let followingQuery = `
    SELECT 
      following_user_id 
    FROM
      follower
    WHERE
      follower_user_id = ${user_id}
      AND following_user_id = ${tweet.user_id}
  `
  let following = await db.get(followingQuery)
  if (following) {
    let tweetQuery = `
      SELECT tweet_id, tweet, date_time AS dateTime FROM tweet WHERE tweet_id = ${tweetId}
    `
    let replyQuery = `
      SELECT SUM(
          CASE  
          WHEN reply_id IS NOT NULL THEN 1 
          ELSE 0
          END) AS replies ,
          tweet.tweet_id
      FROM 
          reply left join tweet on reply.tweet_id = tweet.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      GROUP BY tweet.tweet_id
    `
    let likeQuery = `
      SELECT SUM(
          CASE  
          WHEN like_id IS NOT NULL THEN 1 
          ELSE 0
          END) AS likes,
          tweet.tweet_id
      FROM 
          like left join tweet on like.tweet_id = tweet.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      GROUP BY tweet.tweet_id
    `
    let tweetsDetail = await db.get(tweetQuery)
    let replies = await db.get(replyQuery)
    let likes = await db.get(likeQuery)

    let repliesNum = replies
    if (!repliesNum) {
      repliesNum = 0
    } else {
      repliesNum = repliesNum.replies
    }
    let likesNum = likes
    if (!likesNum) {
      likesNum = 0
    } else {
      likesNum = likesNum.likes
    }
    let tweetDetails = {
      tweet: tweetsDetail.tweet,
      replies: repliesNum,
      likes: likesNum,
      dateTime: tweetsDetail.dateTime,
    }

    res.send(tweetDetails)
  } else {
    res.status(401).send('Invalid Request')
  }
})

app.get('/tweets/:tweetId/likes', authenticateToken, async (req, res) => {
  let {tweetId} = req.params
  let {user_id} = req
  let tweetQuery = `
    SELECT
      *
    FROM 
      tweet
    WHERE
      tweet_id = ${tweetId}
  `
  let tweet = await db.get(tweetQuery)
  let followingQuery = `
    SELECT 
      following_user_id 
    FROM
      follower
    WHERE
      follower_user_id = ${user_id}
  `
  let following = await db.all(followingQuery)
  following = following.map(obj => obj.following_user_id)
  if (following.indexOf(tweet.user_id) !== -1) {
    let likeQuery = `
      SELECT username FROM like left join user on user.user_id = like.user_id WHERE like.tweet_id = ${tweet.tweet_id}
    `
    let likes = await db.all(likeQuery)
    likes = likes.map(obj => obj.username)
    res.send({likes: likes})
  } else {
    res.status(401).send('Invalid Request')
  }
})

app.get('/tweets/:tweetId/replies', authenticateToken, async (req, res) => {
  let {tweetId} = req.params
  let {user_id} = req
  let tweetQuery = `
    SELECT
      *
    FROM 
      tweet
    WHERE
      tweet_id = ${tweetId}
  `
  let tweet = await db.get(tweetQuery)
  let followingQuery = `
    SELECT 
      following_user_id 
    FROM
      follower
    WHERE
      follower_user_id = ${user_id}
  `
  let following = await db.all(followingQuery)
  following = following.map(obj => obj.following_user_id)
  if (following.indexOf(tweet.user_id) !== -1) {
    let replyQuery = `
      SELECT name, reply FROM reply left join user on user.user_id = reply.user_id WHERE reply.tweet_id = ${tweet.tweet_id}
    `
    let replies = await db.all(replyQuery)
    res.send({replies: replies})
  } else {
    res.status(401).send('Invalid Request')
  }
})

app.get('/user/tweets', authenticateToken, async (req, res) => {
  let {user_id} = req
  let tweetQuery = `
    SELECT tweet_id, tweet, date_time AS dateTime FROM tweet WHERE user_id = ${user_id}
  `
  let replyQuery = `
    SELECT SUM(
        CASE  
        WHEN reply_id IS NOT NULL THEN 1 
        ELSE 0
        END) AS replies ,
        tweet.tweet_id
    FROM 
        reply left join tweet on reply.tweet_id = tweet.tweet_id
    GROUP BY tweet.tweet_id
  `
  let likeQuery = `
    SELECT SUM(
        CASE  
        WHEN like_id IS NOT NULL THEN 1 
        ELSE 0
        END) AS likes,
        tweet.tweet_id
    FROM 
        like left join tweet on like.tweet_id = tweet.tweet_id
    GROUP BY tweet.tweet_id
  `
  let tweetsDetail = await db.all(tweetQuery)
  let replies = await db.all(replyQuery)
  let likes = await db.all(likeQuery)
  let tweetDetails = []
  for (let i of tweetsDetail) {
    let repliesNum = replies.find(obj => obj.tweet_id === i.tweet_id)
    if (!repliesNum) {
      repliesNum = 0
    } else {
      repliesNum = repliesNum.replies
    }
    let likesNum = likes.find(obj => obj.tweet_id === i.tweet_id)
    if (!likesNum) {
      likesNum = 0
    } else {
      likesNum = likesNum.likes
    }
    let temp = {
      tweet: i.tweet,
      replies: repliesNum,
      likes: likesNum,
      dateTime: i.dateTime,
    }
    tweetDetails.push(temp)
  }
  res.send(tweetDetails)
})

app.post('/user/tweets', authenticateToken, async (req, res) => {
  let {user_id} = req
  let {tweet} = req.body
  let tweetQuery = `
    INSERT INTO 
      tweet (user_id, tweet, date_time) 
    VALUES
      (${user_id}, '${tweet}', '${new Date()}')
  `
  let dbResponse = await db.run(tweetQuery)
  res.send('Created a Tweet')
})

app.delete('/tweets/:tweetId', authenticateToken, async (req, res) => {
  let {user_id} = req
  let {tweetId} = req.params
  let tweetQuery = `
    SELECT
      user_id
    FROM 
      tweet
    WHERE
      tweet_id = ${tweetId} AND user_id = ${user_id}
  `
  let dbResponse = await db.get(tweetQuery)
  if (!dbResponse) {
    res.status(401).send('Invalid Request')
  } else {
    let deleteQuery = `
      DELETE FROM
        tweet 
      WHERE 
        tweet_id = ${tweetId}
    `
    await db.run(deleteQuery)
    res.send('Tweet Removed')
  }
})

module.exports = app
