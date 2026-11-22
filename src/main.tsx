import { render } from "solid-js/web";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
