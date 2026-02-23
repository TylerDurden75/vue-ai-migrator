/**
 * Fixture for tests - main.js with app.provide for inject-global-composable rule
 */
import { createApp } from "vue";
import App from "./App.vue";
import { useUser } from "@/composables/useUser";

const app = createApp(App);
app.provide("user", useUser());
app.mount("#app");
