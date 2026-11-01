<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api.ts'
import { when } from '../format.ts'

type Post = {
  id: string
  target: 'facebook' | 'instagram' | 'website'
  text: string
  url: string | null
  createdAt: number
  images: string[]
}

const posts = ref<Post[] | null>(null)

onMounted(async () => {
  posts.value = (await api<{ posts: Post[] }>('/api/posts')).posts
})

const where: Record<Post['target'], string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram',
  website: 'Website',
}
</script>

<template>
  <h1 class="page-title">Posts</h1>
  <p class="mt-2 max-w-2xl text-muted">
    Ads and banners the assistant published after you approved them, newest first.
  </p>
  <p v-if="posts && !posts.length" class="panel mt-6 p-6 text-muted">
    Nothing posted yet. Ask the assistant to make an ad for a product and post it on your Page,
    Instagram or website.
  </p>
  <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <article v-for="p in posts ?? []" :key="p.id" class="panel overflow-hidden">
      <img
        v-if="p.images[0]"
        :src="p.images[0]"
        alt=""
        class="aspect-square w-full bg-sky object-cover"
      />
      <div class="p-4">
        <p class="flex items-center justify-between text-sm">
          <span class="font-medium">{{ where[p.target] }}</span>
          <span class="text-muted">{{ when(p.createdAt) }}</span>
        </p>
        <p class="mt-2 line-clamp-4 text-sm whitespace-pre-line">{{ p.text }}</p>
        <p v-if="p.images.length > 1" class="mt-1 text-xs text-muted">
          {{ p.images.length }} images
        </p>
        <a
          v-if="p.url"
          :href="p.url"
          target="_blank"
          rel="noopener"
          class="mt-3 inline-block text-sm font-medium text-ink hover:underline"
          >Open the post</a
        >
      </div>
    </article>
  </div>
</template>
