const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const bcrypt = require('bcrypt');
const cookie = require('cookie');
const querystring = require('querystring');

const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'todo_user',
    password: '1234',
    database: 'todolist',
};

// Сессионное хранилище (в реальном приложении используйте Redis или базу данных)
const sessions = {};

// Middleware для проверки аутентификации
async function checkAuth(req) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const sessionId = cookies.sessionId;

    if (!sessionId || !sessions[sessionId]) {
        return null;
    }

    return sessions[sessionId].userId;
}

// Функции для работы с пользователями
async function createUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
    const [result] = await connection.execute(query, [username, hashedPassword]);
    await connection.end();
    return result.insertId;
}

async function verifyUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'SELECT id, password_hash FROM users WHERE username = ?';
    const [rows] = await connection.execute(query, [username]);
    await connection.end();

    if (rows.length === 0) {
        return null;
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    return isValid ? user.id : null;
}

// Функции для работы с задачами
async function retrieveListItems(userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items WHERE user_id = ? ORDER BY id';
        const [rows] = await connection.execute(query, [userId]);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function deleteItemFromDB(id) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM items WHERE id = ?';
        await connection.execute(query, [id]);
        await connection.end();
    } catch (error) {
        console.error('Error deleting item:', error);
        throw error;
    }
}

async function getHtmlRows(userId) {
    const todoItems = await retrieveListItems(userId);
    return todoItems.map(item => `
    <tr>
    <td>${item.id}</td>
    <td>${item.text}</td>
    <td><button class="delete-btn" data-id="${item.id}">×</button></td>
    </tr>
    `).join('');
}

async function serveLoginPage(res) {
    try {
        const html = await fs.promises.readFile(path.join(__dirname, 'login.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading login page');
    }
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Обработка статических файлов
    if (req.method === 'GET' && parsedUrl.pathname === '/styles.css') {
        try {
            const css = await fs.promises.readFile(path.join(__dirname, 'styles.css'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(css);
        } catch (err) {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    // Обработка маршрутов аутентификации
    if (req.method === 'GET' && parsedUrl.pathname === '/login') {
        await serveLoginPage(res);
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = Object.fromEntries(new URLSearchParams(body));

            try {
                const userId = await verifyUser(username, password);
                if (userId) {
                    const sessionId = require('crypto').randomBytes(16).toString('hex');
                    sessions[sessionId] = { userId };

                    res.writeHead(302, {
                        'Location': '/',
                        'Set-Cookie': cookie.serialize('sessionId', sessionId, {
                            httpOnly: true,
                            maxAge: 60 * 60 * 24 * 7 // 1 week
                        })
                    });
                    res.end();
                } else {
                    res.writeHead(302, { 'Location': '/login?error=1' });
                    res.end();
                }
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Login error');
            }
        });
        return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/register') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'register.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading register page');
        }
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/register') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = Object.fromEntries(new URLSearchParams(body));

            try {
                await createUser(username, password);
                res.writeHead(302, { 'Location': '/login' });
                res.end();
            } catch (error) {
                console.error(error);
                res.writeHead(302, { 'Location': '/register?error=1' });
                res.end();
            }
        });
        return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/logout') {
        const cookies = cookie.parse(req.headers.cookie || '');
        const sessionId = cookies.sessionId;

        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }

        res.writeHead(302, {
            'Location': '/login',
            'Set-Cookie': cookie.serialize('sessionId', '', {
                httpOnly: true,
                expires: new Date(0)
            })
        });
        res.end();
        return;
    }

    // Проверка аутентификации для защищенных маршрутов
    const userId = await checkAuth(req);

    if (!userId && parsedUrl.pathname !== '/login' && parsedUrl.pathname !== '/register') {
        res.writeHead(302, { 'Location': '/login' });
        res.end();
        return;
    }

    // Обработка защищенных маршрутов
    if (req.method === 'GET' && parsedUrl.pathname === '/') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', await getHtmlRows(userId));

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
    }
    else if (req.method === 'POST' && parsedUrl.pathname === '/delete') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { id } = querystring.parse(body);
            if (id) {
                try {
                    await deleteItemFromDB(id);
                    res.writeHead(302, { 'Location': '/' });
                    res.end();
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error deleting item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid ID');
            }
        });
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
