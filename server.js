const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://luacn-server-point-bot-deshboard.onrender.com/auth/discord/callback';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';

app.use(express.json());
app.use(session({
    secret: 'luacn-secret-key-9999',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/');
}

app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.send(`
        <div style="text-align:center; margin-top: 100px; font-family: sans-serif; background-color: #1e1f22; color: white; height: 100vh; padding-top: 50px;">
            <h1>🤖 루칸 포인트 대시보드</h1>
            <p>서비스를 이용하시려면 디스코드 로그인이 필요합니다.</p>
            <br>
            <a href="/auth/discord" style="background:#5865F2; color:white; padding:12px 24px; text-decoration:none; border-radius:5px; font-weight:bold;">Discord로 로그인</a>
        </div>
    `);
});

app.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/user', checkAuth, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        avatar: req.user.avatar 
            ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`
    });
});

// 디스코드 ID로 유저 프로필 조회 API
app.get('/api/discord-user/:id', checkAuth, async (req, res) => {
    const targetId = req.params.id;
    try {
        const response = await axios.get(`https://discord.com/api/v10/users/${targetId}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        const userData = response.data;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${(userData.discriminator || 0) % 5}.png`;

        res.json({
            success: true,
            id: userData.id,
            username: userData.global_name || userData.username,
            tag: userData.username,
            avatar: avatarUrl
        });
    } catch (error) {
        console.error('디스코드 유저 조회 에러:', error.response ? error.response.data : error.message);
        res.json({ success: false, message: '존재하지 않거나 조회할 수 없는 유저 ID입니다.' });
    }
});

let botSocket = null;

io.on('connection', (socket) => {
    socket.on('bot_register', () => {
        botSocket = socket;
        console.log('🤖 디스코드 봇 소켓 연결됨');
    });

    socket.on('request_user_point', (data) => {
        if (botSocket) botSocket.emit('get_user_point', data);
    });

    socket.on('send_user_point', (data) => {
        io.emit('update_user_point', data);
    });

    socket.on('submit_transfer', (data) => {
        if (botSocket) botSocket.emit('process_transfer', data);
    });

    socket.on('transfer_result', (data) => {
        io.emit('transfer_response', data);
    });

    socket.on('request_user_mission', (data) => {
        if (botSocket) botSocket.emit('get_user_mission', data);
    });

    socket.on('send_user_mission', (data) => {
        io.emit('update_user_mission', data);
    });

    socket.on('request_auctions', () => {
        if (botSocket) botSocket.emit('get_auctions');
    });

    socket.on('send_auctions', (data) => {
        io.emit('update_auctions', data);
    });

    socket.on('submit_bid', (data) => {
        if (botSocket) botSocket.emit('process_bid', data);
    });

    socket.on('bid_result', (data) => {
        io.emit('bid_response', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`웹서버 포트: ${PORT}`));
