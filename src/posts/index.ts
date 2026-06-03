// 列表/标签/归档:仅取元数据(不打包正文,减小 main bundle)
const metaModules = import.meta.glob('../content/posts/**/*.md', {
  eager: true,
  query: '?meta',
  import: 'default',
})

export interface PostMeta {
  slug: string
  title: string
  date: string
  tags: string[]
  summary?: string
}

const all: PostMeta[] = Object.values(metaModules).map((mod: any) => {
  const fm = mod.frontmatter ?? {}
  return {
    slug: mod.slug,
    title: (fm.title as string) ?? mod.slug,
    date: (fm.date as string) ?? '',
    tags: (fm.tags as string[]) ?? [],
    summary: (fm.summary as string) ?? '',
  }
}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

export const posts: PostMeta[] = all

// 详情页:按 slug 动态加载完整模块(包含正文,触发独立 chunk)
export async function loadPost(slug: string) {
  const mod: any = await import(`../content/posts/${slug}.md?full`)
  return {
    frontmatter: mod.frontmatter,
    content: mod.content,
  }
}
