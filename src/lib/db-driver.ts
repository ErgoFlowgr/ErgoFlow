export interface DbDriver {
  query(sql: string, params?: unknown[]): Promise<unknown[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>
  get(sql: string, params?: unknown[]): Promise<unknown | undefined>
  switch(userId: string): Promise<void>
  bulkDeleteCustomers(ids: string[]): Promise<void>
}

export const db: DbDriver = {
  query:               (sql, params) => window.electron!.db.query(sql, params),
  run:                 (sql, params) => window.electron!.db.run(sql, params),
  get:                 (sql, params) => window.electron!.db.get(sql, params),
  switch:              (userId)      => window.electron!.db.switch(userId),
  bulkDeleteCustomers: (ids)         => window.electron!.db.bulkDeleteCustomers(ids),
}
