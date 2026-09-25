import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import log from '../log.js';

const _require = createRequire(import.meta.url);

type SQLModule = any;
let SQLPromise: Promise<SQLModule> | null = null;

async function loadSqlJs(): Promise<SQLModule> {
	if (!SQLPromise) {
		SQLPromise = (async () => {
			const init = _require('sql.js');
			const base = path.dirname(_require.resolve('sql.js/dist/sql-wasm.js'));
			return init({ locateFile: (file: string) => path.join(base, file) });
		})();
	}
	return SQLPromise;
}

export async function openWasmDb(dbPath: string) {
	const SQL = await loadSqlJs();
	let data: Uint8Array | undefined;
	try {
		if (fs.existsSync(dbPath)) data = fs.readFileSync(dbPath);
	} catch (err) {
		log.warn('[DB][WASM] Failed to read DB, creating new:', (err as any)?.message || err);
	}
	const db = new SQL.Database(data);

	// KEY FIX: db.export() interferes with active transactions (causes COMMIT to fail).
	// We skip persist() while inside a transaction and only persist after COMMIT.
	let inTx = false;

	function persist() {
		if (inTx) return; // never export mid-transaction
		try {
			const buf = db.export();
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			fs.writeFileSync(dbPath, Buffer.from(buf));
		} catch (err) {
			log.warn('[DB][WASM] Failed to persist DB:', (err as any)?.message || err);
		}
	}

	// sql.js throws plain strings, not Errors. Left alone that means `err.message`
	// is undefined all the way up the stack and the caller reports its fallback
	// text instead of what actually went wrong.
	function asError(err: any): Error {
		if (err instanceof Error) return err;
		return new Error(typeof err === 'string' ? err : JSON.stringify(err));
	}

	/**
	 * A statement is prepared per call, not once per object.
	 *
	 * better-sqlite3 lets you prepare once and run many times, so that is what
	 * calling code naturally writes. Here the underlying statement is freed
	 * after a single step, and the second call died with a bare "Statement
	 * closed" — no message, and the writes after the first were silently lost.
	 * Preparing per call costs the same for the usual one-shot use and makes
	 * reuse behave the way it reads.
	 */
	function Statement(sql: string) {
		function withStmt<T>(params: any[], fn: (stmt: any) => T): T {
			let stmt: any;
			try {
				stmt = db.prepare(sql);
				if (params.length) stmt.bind(params);
				return fn(stmt);
			} catch (err) {
				throw asError(err);
			} finally {
				if (stmt) { try { stmt.free(); } catch {} }
			}
		}

		return {
			run(...params: any[]) {
				const changes = withStmt(params, (stmt) => {
					stmt.step();
					return db.getRowsModified ? db.getRowsModified() : 0;
				});
				persist(); // no-op when inTx=true
				return { changes };
			},
			get(...params: any[]) {
				return withStmt(params, (stmt) => (stmt.step() ? stmt.getAsObject() : undefined));
			},
			all(...params: any[]) {
				return withStmt(params, (stmt) => {
					const rows: any[] = [];
					while (stmt.step()) rows.push(stmt.getAsObject());
					return rows;
				});
			}
		};
	}

	function transaction(fn: Function) {
		return function wrapped(...args: any[]) {
			if (inTx) return fn.apply(null, args); // nested: just run
			inTx = true;
			try {
				db.exec('BEGIN');
				const res = fn.apply(null, args);
				db.exec('COMMIT');
				inTx = false;
				persist(); // persist once after commit
				return res;
			} catch (err) {
				inTx = false;
				try { db.exec('ROLLBACK'); } catch {}
				throw asError(err);
			}
		};
	}

	// Direct exec for sales:create BEGIN/COMMIT (bypasses wrapper transaction)
	function execDirect(sql: string) {
		const s = sql.trim().toUpperCase();
		if (s === 'BEGIN')    { inTx = true;  db.exec(sql); return; }
		if (s === 'COMMIT')   { db.exec(sql); inTx = false; persist(); return; }
		if (s === 'ROLLBACK') { inTx = false; try { db.exec(sql); } catch {} return; }
		db.exec(sql);
	}

	function pragma(sql: string) {
		try { db.exec('PRAGMA ' + sql); } catch {}
	}

	function close() {
		try { persist(); } catch {}
		try { db.close(); } catch {}
	}

	return {
		prepare: (sql: string) => Statement(sql),
		transaction,
		pragma,
		close,
		exec: execDirect,
	};
}

