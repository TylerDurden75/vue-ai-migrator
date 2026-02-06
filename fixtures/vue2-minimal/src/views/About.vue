<template>
  <div class="about">
    <h1>About</h1>
    <p>{{ message | capitalize }}</p>
  </div>
</template>

<script>
export default {
  name: 'About',
  data() {
    return {
      message: 'hello world',
    };
  },
  filters: {
    capitalize(value) {
      if (!value) return '';
      return value.charAt(0).toUpperCase() + value.slice(1);
    },
  },
};
</script>
