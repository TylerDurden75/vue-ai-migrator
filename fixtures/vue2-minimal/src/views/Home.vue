<template>
  <div class="home">
    <h1>Home</h1>
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';

export default {
  name: 'Home',
  computed: {
    ...mapState(['count']),
  },
  methods: {
    ...mapActions(['increment']),
  },
};
</script>
