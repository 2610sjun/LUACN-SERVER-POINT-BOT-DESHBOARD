const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 📌 3단계 배포 완료 후 디스코드 개발자 센터 설정값을 입력할 예정입니다.
const CLIENT_ID = process.env.CLIENT_ID || '디스코드_클라이언트_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '디스코드_클라이언트_시크릿';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://your-app.onrender.com/auth/discord/callback';

app.use(express.json());
app.use(session({
    secret: 'secret-key-1234',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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
            <h1>🤖 디스코드 봇 대시보드</h1>
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
        avatar: `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
    });
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