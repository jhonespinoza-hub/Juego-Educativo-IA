const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();

// Configuración amplia de CORS para desarrollo
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 1. AUTENTICACIÓN Y DOCENTES
// ==========================================

app.post('/api/login', async (req, res) => {
    const { correo, password } = req.body;
    if (!correo || !password) {
        return res.status(400).json({ error: 'Por favor, ingresa correo y contraseña.' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM docentes WHERE correo = ?', [correo]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const docente = rows[0];
        const isMatch = await bcrypt.compare(password, docente.password);

        if (!isMatch) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        res.json({
            status: 'ok',
            message: 'Acceso concedido',
            docente: {
                id_docente: docente.id_docente || docente.id,
                nombre: docente.nombre || docente.nombre_completo,
                correo: docente.correo
            }
        });
    } catch (err) {
        console.error('Error en /api/login:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/docentes', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM docentes');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/docentes', async (req, res) => {
    const { nombre, correo, password } = req.body;
    if (!nombre || !correo || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO docentes (nombre, correo, password) VALUES (?, ?, ?)',
            [nombre, correo, hashedPassword]
        );
        res.status(201).json({ status: 'ok', id_docente: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'El correo electrónico ya se encuentra registrado.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. API DE JUEGO Y REPORTES
// ==========================================

app.get('/api/cursos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM cursos');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OBTENER CURSOS POR ID DE DOCENTE (Soporta IDs Numéricos y Cadenas)
app.get('/api/cursos/docente/:idDocente', async (req, res) => {
    try {
        const idDocente = req.params.idDocente;
        
        if (!idDocente || idDocente === 'undefined' || idDocente === 'null') {
            return res.status(400).json({ error: 'ID de docente no válido.' });
        }

        const [rows] = await db.query('SELECT * FROM cursos WHERE id_docente = ?', [idDocente]);
        res.json(rows);
    } catch (err) {
        console.error('Error al consultar cursos del docente:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/alumnos/:idCurso', async (req, res) => {
    try {
        const idCurso = req.params.idCurso;

        if (!idCurso || idCurso === 'undefined' || idCurso === 'null') {
            return res.status(400).json({ error: 'ID de curso no válido.' });
        }

        const [rows] = await db.query('SELECT * FROM alumnos WHERE id_curso = ?', [idCurso]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidas', async (req, res) => {
    const { id_alumno, puntuacion, tiempo, errores, id_juego = 2 } = req.body;
    
    try {
        await db.query('CALL sp_guardar_partida(?, ?, ?, ?, @id_partida)', [
            id_alumno, puntuacion, tiempo, id_juego
        ]);
        
        const [idResult] = await db.query('SELECT @id_partida AS id_partida');
        const id_partida = idResult[0].id_partida;

        if (errores && errores.length > 0) {
            const errorValues = errores.map(e => [
                id_partida, 
                e.operacion || e.op, 
                e.esperado || e.esp, 
                e.mostrado || e.det
            ]);

            await db.query(
                'INSERT INTO detalle_errores (id_partida, operacion_planteada, respuesta_esperada, respuesta_detectada) VALUES ?',
                [errorValues]
            );
        }

        res.json({ status: 'ok', id_partida });
    } catch (err) {
        console.error('Error al guardar partida:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reportes', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM vista_reportes_docente ORDER BY fecha_partida DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. RUTAS DE ADMINISTRACIÓN
// ==========================================

app.post('/api/cursos', async (req, res) => {
    const { nombre_curso, id_docente } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO cursos (nombre_curso, id_docente) VALUES (?, ?)',
            [nombre_curso, id_docente]
        );
        res.status(201).json({ status: 'ok', id_curso: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/alumnos', async (req, res) => {
    const { nombre_completo, codigo_estudiante, id_curso } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO alumnos (nombre_completo, codigo_estudiante, id_curso) VALUES (?, ?, ?)',
            [nombre_completo, codigo_estudiante || null, id_curso]
        );
        res.status(201).json({ status: 'ok', id_alumno: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. IMPORTACIÓN MASIVA EXCEL
// ==========================================

app.post('/api/alumnos/upload-excel', upload.single('excelFile'), async (req, res) => {
    try {
        const { id_curso } = req.body;

        if (!req.file || !id_curso) {
            return res.status(400).json({ error: 'Falta el archivo o el ID del curso.' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (sheetData.length === 0) {
            return res.status(400).json({ error: 'El archivo Excel no contiene datos.' });
        }

        const values = sheetData
            .map(row => {
                const nombre = row.nombre_completo || row.Nombre || row.ALUMNO || row.alumno;
                const codigo = row.codigo_estudiante || row.Codigo || row.CODIGO || null;
                return nombre ? [nombre, codigo, id_curso] : null;
            })
            .filter(row => row !== null);

        if (values.length === 0) {
            return res.status(400).json({ error: 'No se encontraron nombres de alumnos válidos en el archivo.' });
        }

        const query = 'INSERT INTO alumnos (nombre_completo, codigo_estudiante, id_curso) VALUES ?';
        const [result] = await db.query(query, [values]);

        res.json({
            status: 'ok',
            message: `¡Importación exitosa! Se guardaron ${result.affectedRows} alumnos.`
        });
    } catch (err) {
        console.error('Error al importar archivo Excel:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor listo ejecutándose en el puerto ${PORT}`);
});