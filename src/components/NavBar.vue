<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="navbar">
    <div class="navbar-inner container">
      <RouterLink to="/" class="brand">docus</RouterLink>
      <nav class="nav-links">
        <RouterLink to="/posts">Posts</RouterLink>
        <RouterLink to="/archives">Archives</RouterLink>
        <RouterLink to="/tags">Tags</RouterLink>
      </nav>
    </div>
  </header>
</template>
