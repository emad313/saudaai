import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { newId } from '../db/ids.ts'
import { posts } from '../db/schema.ts'

type Post = typeof posts.$inferInsert

export async function recordPost(db: Db, post: Omit<Post, 'id'>) {
  await db.insert(posts).values({ ...post, id: newId() })
}

export function listPosts(db: Db, shopId: string) {
  return db
    .select()
    .from(posts)
    .where(eq(posts.shopId, shopId))
    .orderBy(desc(posts.createdAt))
    .limit(100)
}
