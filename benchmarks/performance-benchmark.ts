<template>
<div>
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useUserStore } from '@/store/modules/user'

const title = ref('Component ${i}');

const description = ref('Description ${i}');
const userStore = useUserStore();
const currentUser = computed(() => userStore.currentUser)
</script>