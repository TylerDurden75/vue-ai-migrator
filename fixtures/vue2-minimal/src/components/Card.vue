<template>
  <div class="card">
    <slot :text="title"></slot>
  </div>
</template>

<script>
export default {
  name: 'Card',
  props: {
    title: String,
  },
};
</script>
