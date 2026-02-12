<template>
  <div class="home">
    <h1>Home</h1>
    <p>Count: {{ count }}</p>
    <Card :title="'Welcome'">
      <template slot-scope="scope">{{ scope.text }}</template>
    </Card>
    <button @click="increment">Increment</button>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';
import Card from '../components/Card.vue';

export default {
  components: { Card },
  name: 'Home',
  computed: {
    ...mapState(['count']),
  },
  methods: {
    ...mapActions(['increment']),
  },
};
</script>
