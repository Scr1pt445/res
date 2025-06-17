"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MyPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian8 = require("obsidian");

// src/utils.ts
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var ADMIN_VIEW_TYPE = "obsidian-access-admin-view";
var USER_VIEW_TYPE = "obsidian-access-user-view";
var DEFAULT_SETTINGS = {
  currentUser: null,
  firstAdminSetupDone: false,
  gitRepoUrl: "",
  gitBranch: "main",
  gitAuthToken: "",
  encryptionKey: ""
};
var SERVICE_FILES = ["access.json", "events.json"];
var SERVICE_FOLDERS = [".git"];
function isServiceFile(path) {
  if (SERVICE_FILES.includes(path))
    return true;
  return SERVICE_FOLDERS.some((folder) => path.startsWith(folder));
}
async function safeCreateFolder(app, path) {
  try {
    await app.vault.createFolder(path);
  } catch (e) {
    if (e?.message?.includes("already exists"))
      return;
    throw e;
  }
}
async function safeCreateOrUpdateFile(app, path, content) {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof import_obsidian.TFile) {
    await app.vault.modify(f, content);
  } else {
    const parts = path.split("/");
    if (parts.length > 1) {
      let base = "";
      for (let i = 0; i < parts.length - 1; i++) {
        base += (i === 0 ? "" : "/") + parts[i];
        if (!app.vault.getAbstractFileByPath(base)) {
          await safeCreateFolder(app, base);
        }
      }
    }
    try {
      await app.vault.create(path, content);
    } catch (e) {
      if (e?.message?.includes("already exists")) {
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof import_obsidian.TFile) {
          await app.vault.modify(existing, content);
        }
      } else {
        throw e;
      }
    }
  }
}
function getAllVaultFiles(app, skipService = false) {
  const res = [];
  const walk = (folder) => {
    for (const child of folder.children) {
      if (child instanceof import_obsidian.TFile) {
        if (!skipService || !isServiceFile(child.path))
          res.push(child.path);
      }
      if (child instanceof import_obsidian.TFolder && !SERVICE_FOLDERS.includes(child.name))
        walk(child);
    }
  };
  walk(app.vault.getRoot());
  return res;
}
function getUserPermission(user, access, filePath) {
  if (!user)
    return "none";
  if (user.role === "admin")
    return "full";
  const userGroups = access.groups.filter((g) => g.members.includes(user.email));
  let maxPerm = "none";
  for (const group of userGroups) {
    if (!group.permissions)
      continue;
    if (group.permissions[filePath]) {
      maxPerm = permGreater(maxPerm, group.permissions[filePath]);
    } else {
      const pathParts = filePath.split("/");
      while (pathParts.length > 1) {
        pathParts.pop();
        const parentPath = pathParts.join("/");
        if (group.permissions[parentPath]) {
          maxPerm = permGreater(maxPerm, group.permissions[parentPath]);
          break;
        }
      }
    }
  }
  return maxPerm;
}
function permGreater(a, b) {
  const order = { none: 0, read: 1, edit: 2, full: 3 };
  return order[a] > order[b] ? a : b;
}
async function ensureGitRepo(vaultPath, git) {
  return new Promise((resolve, reject) => {
    const authPart = git.authToken ? git.authToken + "@" : "";
    const remote = git.repoUrl.replace("https://", `https://${authPart}`);
    (0, import_child_process.exec)(`cd "${vaultPath}" && git rev-parse --is-inside-work-tree`, (err) => {
      if (!err) {
        (0, import_child_process.exec)(`cd "${vaultPath}" && (git remote set-url origin ${remote} || git remote add origin ${remote}) && git fetch origin`, (err2) => {
          if (err2)
            return reject(err2);
          (0, import_child_process.exec)(`cd "${vaultPath}" && (git checkout ${git.branch} || git checkout -b ${git.branch})`, (err3) => {
            if (err3)
              return reject(err3);
            resolve();
          });
        });
      } else {
        (0, import_child_process.exec)(
          `cd "${vaultPath}" && git init && git remote add origin ${remote} && git fetch origin && (git checkout ${git.branch} || git checkout -b ${git.branch})`,
          (err3) => err3 ? reject(err3) : resolve()
        );
      }
    });
  });
}
function execGitCommand(cmd, cwd) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.exec)(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        console.error("GIT ERROR:", stderr || err);
        reject(stderr || err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
async function importKey(base64Key) {
  const raw = base64ToUint8Array(base64Key);
  return crypto.subtle.importKey(
    "raw",
    raw,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptString(plainText, base64Key) {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encoded = encoder.encode(plainText);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv);
  combined.set(cipherBytes, iv.length);
  return uint8ArrayToBase64(combined);
}
async function decryptString(cipherTextBase64, base64Key) {
  const combined = base64ToUint8Array(cipherTextBase64);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await importKey(base64Key);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
async function loadAndDecryptAccessJson(app, keyBase64) {
  const path = "access.json";
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof import_obsidian.TFile) {
    const encryptedText = await app.vault.read(f);
    try {
      const decryptedText = await decryptString(encryptedText, keyBase64);
      return JSON.parse(decryptedText);
    } catch (e) {
      console.error("\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 access.json", e);
      return { users: [], groups: [] };
    }
  }
  const empty = { users: [], groups: [] };
  const encryptedEmpty = await encryptString(JSON.stringify(empty, null, 2), keyBase64);
  await safeCreateOrUpdateFile(app, path, encryptedEmpty);
  return empty;
}
async function encryptAndSaveAccessJson(app, keyBase64, data) {
  const path = "access.json";
  const jsonStr = JSON.stringify(data, null, 2);
  const encrypted = await encryptString(jsonStr, keyBase64);
  await safeCreateOrUpdateFile(app, path, encrypted);
}

// src/SetupAdminModal.ts
var import_obsidian3 = require("obsidian");

// src/TokenModal.ts
var import_obsidian2 = require("obsidian");
var TokenModal = class extends import_obsidian2.Modal {
  constructor(app, token) {
    super(app);
    this.token = token;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "\u0422\u043E\u043A\u0435\u043D \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" });
    const tokenEl = contentEl.createEl("textarea", { text: this.token });
    tokenEl.style.width = "100%";
    tokenEl.style.height = "80px";
    tokenEl.style.fontSize = "14px";
    tokenEl.style.resize = "none";
    tokenEl.readOnly = true;
    const copyBtn = new import_obsidian2.ButtonComponent(contentEl);
    copyBtn.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D");
    copyBtn.onClick(() => {
      tokenEl.select();
      document.execCommand("copy");
      copyBtn.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E!");
      setTimeout(() => copyBtn.setButtonText("\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D"), 1500);
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/SetupAdminModal.ts
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let binary = "";
  for (let i = 0; i < array.byteLength; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}
var SetupAdminModal = class extends import_obsidian3.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.background = "#1e2a36";
    containerEl.style.borderRadius = "22px";
    containerEl.style.boxShadow = "0 0 40px #000c";
    containerEl.style.padding = "36px 32px";
    containerEl.style.color = "#fff";
    containerEl.style.maxWidth = "520px";
    containerEl.style.width = "96vw";
    containerEl.style.minWidth = "340px";
    containerEl.style.margin = "auto";
    containerEl.style.position = "fixed";
    containerEl.style.left = "50%";
    containerEl.style.top = "50%";
    containerEl.style.transform = "translate(-50%, -50%)";
    containerEl.style.maxHeight = "96vh";
    containerEl.style.overflowY = "auto";
    const style = document.createElement("style");
    style.innerHTML = `
      .access-setup-setting .setting-item {
        flex-direction: column !important;
        align-items: stretch !important;
        margin-bottom: 16px !important;
        gap: 4px;
      }
      .access-setup-setting input {
        font-size: 17px !important;
        padding: 7px 11px !important;
        border-radius: 7px;
        background: #2a3848;
        color: #fff;
        border: 1px solid #22334a;
        margin-bottom: 0;
      }
      .access-setup-setting .setting-item-name {
        font-size: 15px;
        margin-bottom: 4px;
        color: #b6cef9;
      }
      .access-setup-setting .setting-item-control {
        width: 100%;
      }
      .access-setup-setting .mod-cta {
        margin-top: 10px;
        width: 100%;
        font-size: 17px;
      }
    `;
    containerEl.appendChild(style);
    containerEl.createEl("h2", {
      text: "\u041F\u0435\u0440\u0432\u0438\u0447\u043D\u0430\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430",
      attr: { style: "margin-bottom: 0.5em; font-size:2.1em;" }
    });
    containerEl.createEl("div", {
      text: "\u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430. \u042D\u0442\u043E \u0431\u0443\u0434\u0435\u0442 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0441 \u043F\u043E\u043B\u043D\u044B\u043C\u0438 \u043F\u0440\u0430\u0432\u0430\u043C\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u0430.",
      attr: {
        style: `
          margin-top: 0px;
          margin-bottom: 30px;
          font-size: 15px;
          color: #bfcbe0;
          max-width: 420px;
          line-height: 1.55;
        `
      }
    });
    const sWrap = containerEl.createDiv({ cls: "access-setup-setting" });
    let email = "";
    let password = "";
    let repeat = "";
    new import_obsidian3.Setting(sWrap).setName("Email").addText((t) => {
      t.setPlaceholder("admin@company.com");
      t.inputEl.type = "email";
      t.onChange((v) => email = v.trim());
    });
    new import_obsidian3.Setting(sWrap).setName("\u041F\u0430\u0440\u043E\u043B\u044C").addText((t) => {
      t.setPlaceholder("\u043F\u0430\u0440\u043E\u043B\u044C");
      t.inputEl.type = "password";
      t.onChange((v) => password = v);
    });
    new import_obsidian3.Setting(sWrap).setName("\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C").addText((t) => {
      t.setPlaceholder("\u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C");
      t.inputEl.type = "password";
      t.onChange((v) => repeat = v);
    });
    let gitRepoUrl = "";
    let gitBranch = "main";
    let gitAuthToken = "";
    new import_obsidian3.Setting(sWrap).setName("Git URL (\u043F\u043E \u0436\u0435\u043B\u0430\u043D\u0438\u044E)").addText((t) => {
      t.setPlaceholder("https://github.com/...").onChange((v) => gitRepoUrl = v.trim());
    });
    new import_obsidian3.Setting(sWrap).setName("Git \u0432\u0435\u0442\u043A\u0430").addText((t) => {
      t.setPlaceholder("main").setValue("main").onChange((v) => gitBranch = v.trim());
    });
    new import_obsidian3.Setting(sWrap).setName("Git \u0442\u043E\u043A\u0435\u043D (\u043F\u043E \u0436\u0435\u043B\u0430\u043D\u0438\u044E)").addText((t) => {
      t.setPlaceholder("ghp_...").onChange((v) => gitAuthToken = v.trim());
    });
    new import_obsidian3.Setting(sWrap).addButton(
      (btn) => btn.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430").setCta().onClick(async () => {
        if (!email || !password || !repeat) {
          new import_obsidian3.Notice("\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0432\u0441\u0435 \u043F\u043E\u043B\u044F.");
          return;
        }
        if (!email.includes("@") || email.length < 4) {
          new import_obsidian3.Notice("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 email.");
          return;
        }
        if (password.length < 4) {
          new import_obsidian3.Notice("\u041F\u0430\u0440\u043E\u043B\u044C \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0439.");
          return;
        }
        if (password !== repeat) {
          new import_obsidian3.Notice("\u041F\u0430\u0440\u043E\u043B\u0438 \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442.");
          return;
        }
        const access = await this.plugin.loadAccessJson();
        if (access.users.length > 0) {
          new import_obsidian3.Notice("\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440 \u0443\u0436\u0435 \u0441\u043E\u0437\u0434\u0430\u043D.");
          this.close();
          return;
        }
        const token = generateToken();
        const admin = {
          email,
          password,
          role: "admin",
          token
        };
        access.users.push(admin);
        await this.plugin.saveAccessJson(access);
        new TokenModal(this.app, token).open();
        if (gitRepoUrl) {
          access.git = {
            repoUrl: gitRepoUrl,
            branch: gitBranch || "main",
            authToken: gitAuthToken || ""
          };
        }
        if (!this.plugin.settings.encryptionKey) {
          const array = new Uint8Array(32);
          crypto.getRandomValues(array);
          let binary = "";
          for (let i = 0; i < array.byteLength; i++) {
            binary += String.fromCharCode(array[i]);
          }
          this.plugin.settings.encryptionKey = btoa(binary);
          await this.plugin.saveSettings();
        }
        await this.plugin.saveAccessJson(access);
        this.plugin.settings.firstAdminSetupDone = true;
        this.plugin.settings.currentUser = admin;
        await this.plugin.saveSettings();
        if (gitRepoUrl) {
          await this.plugin.initializeGitRepoIfNeeded?.();
        }
        this.close();
        this.plugin.openAdminView();
      })
    );
  }
  onClose() {
    this.containerEl.empty();
  }
};

// src/LoginModal.ts
var import_obsidian4 = require("obsidian");
var LoginModal = class extends import_obsidian4.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.background = "#222c37";
    containerEl.style.borderRadius = "22px";
    containerEl.style.boxShadow = "0 4px 40px #000a";
    containerEl.style.padding = "0";
    containerEl.style.color = "#fff";
    containerEl.style.maxWidth = "430px";
    containerEl.style.width = "95%";
    containerEl.style.margin = "auto";
    containerEl.style.position = "fixed";
    containerEl.style.left = "50%";
    containerEl.style.top = "50%";
    containerEl.style.transform = "translate(-50%, -50%)";
    containerEl.style.maxHeight = "96vh";
    containerEl.style.overflowY = "auto";
    containerEl.style.display = "flex";
    containerEl.style.flexDirection = "column";
    containerEl.style.alignItems = "center";
    containerEl.style.justifyContent = "center";
    const formBox = containerEl.createDiv();
    formBox.style.display = "flex";
    formBox.style.flexDirection = "column";
    formBox.style.alignItems = "center";
    formBox.style.justifyContent = "center";
    formBox.style.background = "transparent";
    formBox.style.width = "100%";
    formBox.style.padding = "40px 28px 32px 28px";
    formBox.createEl("h2", {
      text: "\u0412\u0445\u043E\u0434 \u0432 \u0431\u0430\u0437\u0443 \u0437\u043D\u0430\u043D\u0438\u0439",
      attr: { style: "margin-bottom:26px;color:#fff;text-align:center;font-size:1.35em;font-weight:700;" }
    });
    const row = formBox.createDiv();
    row.style.display = "flex";
    row.style.flexDirection = "row";
    row.style.alignItems = "center";
    row.style.justifyContent = "center";
    row.style.gap = "10px";
    row.style.width = "100%";
    const emailInput = row.createEl("input");
    emailInput.type = "text";
    emailInput.placeholder = "Email";
    emailInput.autocomplete = "username";
    emailInput.style.width = "152px";
    emailInput.style.background = "#1c2430";
    emailInput.style.color = "#fff";
    emailInput.style.border = "1px solid #35475d";
    emailInput.style.padding = "8px 10px";
    emailInput.style.borderRadius = "8px";
    emailInput.style.fontSize = "15px";
    emailInput.style.outline = "none";
    emailInput.style.transition = "border 0.2s";
    emailInput.onfocus = () => emailInput.style.border = "1.7px solid #a86bfd";
    emailInput.onblur = () => emailInput.style.border = "1px solid #35475d";
    const passInput = row.createEl("input");
    passInput.type = "password";
    passInput.placeholder = "\u041F\u0430\u0440\u043E\u043B\u044C";
    passInput.autocomplete = "current-password";
    passInput.style.width = "124px";
    passInput.style.background = "#1c2430";
    passInput.style.color = "#fff";
    passInput.style.border = "1px solid #35475d";
    passInput.style.padding = "8px 10px";
    passInput.style.borderRadius = "8px";
    passInput.style.fontSize = "15px";
    passInput.style.marginLeft = "7px";
    passInput.style.outline = "none";
    passInput.style.transition = "border 0.2s";
    passInput.onfocus = () => passInput.style.border = "1.7px solid #a86bfd";
    passInput.onblur = () => passInput.style.border = "1px solid #35475d";
    const loginBtn = row.createEl("button");
    loginBtn.textContent = "\u0412\u043E\u0439\u0442\u0438";
    loginBtn.style.background = "#a86bfd";
    loginBtn.style.color = "#fff";
    loginBtn.style.border = "none";
    loginBtn.style.borderRadius = "8px";
    loginBtn.style.padding = "8px 26px";
    loginBtn.style.fontWeight = "bold";
    loginBtn.style.marginLeft = "14px";
    loginBtn.style.cursor = "pointer";
    loginBtn.style.fontSize = "15px";
    loginBtn.style.boxShadow = "0 2px 12px #502a9c22";
    loginBtn.onmouseenter = () => loginBtn.style.background = "#8b57e7";
    loginBtn.onmouseleave = () => loginBtn.style.background = "#a86bfd";
    loginBtn.onclick = async () => {
      try {
        const enteredEmail = emailInput.value.trim();
        const enteredPassword = passInput.value;
        const access = await this.plugin.loadAccessJson();
        const user = access.users.find(
          (u) => u.email === enteredEmail && u.password === enteredPassword
        );
        if (!user) {
          new import_obsidian4.Notice("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C");
          return;
        }
        this.plugin.settings.currentUser = user;
        await this.plugin.saveSettings();
        new import_obsidian4.Notice(`\u0412\u044B \u0432\u043E\u0448\u043B\u0438 \u043A\u0430\u043A ${user.email} (${user.role})`);
        this.close();
        if (user.role === "admin")
          this.plugin.openAdminView();
        else
          this.plugin.openUserView();
      } catch (e) {
        new import_obsidian4.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0432\u0445\u043E\u0434\u0435: " + (e?.message || e));
        console.error("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043B\u043E\u0433\u0438\u043D\u0435:", e);
      }
    };
  }
  onClose() {
    this.containerEl.empty();
  }
};

// src/AdminView.ts
var import_obsidian5 = require("obsidian");
function buildTree(paths) {
  const root = {};
  for (const path of paths) {
    const parts = path.split("/");
    let curr = root;
    for (let i = 0; i < parts.length; i++) {
      if (!curr[parts[i]]) {
        curr[parts[i]] = { __children: {}, __type: i === parts.length - 1 ? "file" : "folder" };
      }
      curr = curr[parts[i]].__children;
    }
  }
  function walk(node, name = "", path = "") {
    return Object.entries(node).map(([k, v]) => {
      const fullPath = path ? `${path}/${k}` : k;
      if (v.__type === "folder") {
        return {
          type: "folder",
          path: fullPath,
          name: k,
          children: walk(v.__children, k, fullPath)
        };
      } else {
        return {
          type: "file",
          path: fullPath,
          name: k
        };
      }
    });
  }
  return walk(root);
}
var AdminView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.tokenValidated = false;
    this.plugin = plugin;
  }
  getViewType() {
    return ADMIN_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.overflowY = "auto";
    containerEl.style.background = "#1e2a36";
    containerEl.style.borderRadius = "22px";
    containerEl.style.padding = "36px 32px";
    containerEl.style.color = "#fff";
    containerEl.style.maxWidth = "660px";
    containerEl.style.margin = "38px auto";
    containerEl.style.boxShadow = "0 0 40px #000a";
    const access = await this.plugin.loadAccessJson();
    const current = this.plugin.settings.currentUser;
    if (!current) {
      containerEl.createEl("p", { text: "\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u043E\u0439\u0434\u0438\u0442\u0435 \u043A\u0430\u043A \u0430\u0434\u043C\u0438\u043D." });
      return;
    }
    if (current.role !== "admin") {
      containerEl.createEl("p", { text: "\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D." });
      return;
    }
    if (!this.tokenValidated) {
      containerEl.createEl("h2", { text: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D \u0434\u043B\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u043F\u0430\u043D\u0435\u043B\u0438" });
      const tokenInput = containerEl.createEl("input", { attr: { type: "password", placeholder: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D" } });
      tokenInput.style.width = "100%";
      tokenInput.style.padding = "10px";
      tokenInput.style.marginTop = "12px";
      tokenInput.style.borderRadius = "6px";
      tokenInput.style.border = "1px solid #394e70";
      tokenInput.style.background = "#232e42";
      tokenInput.style.color = "#f6f7fa";
      tokenInput.style.fontSize = "14px";
      const submitBtn = containerEl.createEl("button", { text: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0442\u043E\u043A\u0435\u043D" });
      submitBtn.style.marginTop = "18px";
      submitBtn.style.padding = "8px 24px";
      submitBtn.style.borderRadius = "6px";
      submitBtn.style.background = "#a86bfd";
      submitBtn.style.color = "#fff";
      submitBtn.style.border = "none";
      submitBtn.style.cursor = "pointer";
      submitBtn.onclick = () => {
        const enteredToken = tokenInput.value.trim();
        if (!enteredToken) {
          new import_obsidian5.Notice("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D");
          return;
        }
        if (current.token !== enteredToken) {
          new import_obsidian5.Notice("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D");
          return;
        }
        this.tokenValidated = true;
        this.render();
      };
      return;
    }
    containerEl.createEl("h1", {
      text: "\u041F\u0430\u043D\u0435\u043B\u044C \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430",
      attr: { style: "text-align:center;margin-bottom:24px;font-size:2.2em;" }
    });
    new import_obsidian5.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("\u0412\u044B\u0439\u0442\u0438").setWarning().onClick(async () => {
        this.plugin.settings.currentUser = null;
        this.tokenValidated = false;
        await this.plugin.saveSettings();
        new import_obsidian5.Notice("\u0412\u044B \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B");
        this.app.workspace.detachLeavesOfType(ADMIN_VIEW_TYPE);
      })
    );
    containerEl.createEl("h2", { text: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438", cls: "adminview-h2" });
    const usersBox = containerEl.createDiv();
    usersBox.className = "adminview-box";
    access.users.forEach((u) => {
      const isCurrentAdmin = u.email === current.email;
      new import_obsidian5.Setting(usersBox).setClass("access-admin-user-row").addText((t) => {
        t.setValue(u.email);
        t.setDisabled(true);
      }).addText((t) => {
        t.setValue(u.password);
        t.inputEl.type = "password";
        t.onChange(async (v) => {
          u.password = v;
          await this.plugin.saveAccessJson(access);
          new import_obsidian5.Notice(`\u041F\u0430\u0440\u043E\u043B\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D \u0434\u043B\u044F ${u.email}`);
        });
      }).addText((t) => {
        t.setValue(u.token || "");
        t.setDisabled(true);
        if (u.role === "admin") {
          t.inputEl.title = "\u0422\u043E\u043A\u0435\u043D \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430 (\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0438 \u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0432 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438)";
        }
      }).addDropdown((dd) => {
        ["user", "admin"].forEach((r) => dd.addOption(r, r));
        dd.setValue(u.role);
        dd.onChange(async (v) => {
          u.role = v;
          await this.plugin.saveAccessJson(access);
          new import_obsidian5.Notice(`\u0420\u043E\u043B\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430 \u0434\u043B\u044F ${u.email}`);
          if (u.email === current.email && v !== "admin") {
            this.plugin.settings.currentUser = null;
            this.tokenValidated = false;
            await this.plugin.saveSettings();
            new import_obsidian5.Notice("\u0412\u044B \u0443\u0442\u0440\u0430\u0442\u0438\u043B\u0438 \u0434\u043E\u0441\u0442\u0443\u043F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430 \u0438 \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B");
            this.app.workspace.detachLeavesOfType(ADMIN_VIEW_TYPE);
          }
        });
        return dd;
      }).addButton(
        (btn) => btn.setIcon("trash").setWarning().onClick(async () => {
          if (isCurrentAdmin) {
            new import_obsidian5.Notice("\u041D\u0435\u043B\u044C\u0437\u044F \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u0435\u0431\u044F!");
            return;
          }
          const token = prompt(`\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u043E\u043A\u0435\u043D \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430 ${u.email} \u0434\u043B\u044F \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F:`);
          if (!token) {
            new import_obsidian5.Notice("\u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E \u2014 \u0442\u043E\u043A\u0435\u043D \u043D\u0435 \u0432\u0432\u0435\u0434\u0451\u043D");
            return;
          }
          if (token !== u.token) {
            new import_obsidian5.Notice("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0442\u043E\u043A\u0435\u043D \u2014 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E");
            return;
          }
          access.users = access.users.filter((x) => x.email !== u.email);
          await this.plugin.saveAccessJson(access);
          new import_obsidian5.Notice(`\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C ${u.email} \u0443\u0434\u0430\u043B\u0451\u043D`);
          this.tokenValidated = false;
          this.plugin.settings.currentUser = null;
          await this.plugin.saveSettings();
          this.app.workspace.detachLeavesOfType(ADMIN_VIEW_TYPE);
        })
      );
    });
    containerEl.createEl("h3", { text: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F", attr: { style: "margin-top:26px;" } });
    let newEmail = "", newPassword = "", newRole = "user";
    new import_obsidian5.Setting(containerEl).setName("Email").addText(
      (t) => t.setPlaceholder("user@\u2026").onChange((v) => newEmail = v.trim())
    );
    new import_obsidian5.Setting(containerEl).setName("\u041F\u0430\u0440\u043E\u043B\u044C").addText((t) => {
      t.setPlaceholder("\u041F\u0430\u0440\u043E\u043B\u044C");
      t.inputEl.type = "password";
      t.onChange((v) => newPassword = v);
    });
    new import_obsidian5.Setting(containerEl).setName("\u0420\u043E\u043B\u044C").addDropdown((dd) => {
      ["user", "admin"].forEach((r) => dd.addOption(r, r));
      dd.setValue(newRole);
      dd.onChange((v) => newRole = v);
      return dd;
    });
    new import_obsidian5.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F").setCta().onClick(async () => {
        if (!newEmail || !newPassword) {
          new import_obsidian5.Notice("Email \u0438 \u043F\u0430\u0440\u043E\u043B\u044C \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B");
          return;
        }
        if (access.users.some((u) => u.email === newEmail)) {
          new import_obsidian5.Notice("\u0422\u0430\u043A\u043E\u0439 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0443\u0436\u0435 \u0435\u0441\u0442\u044C");
          return;
        }
        const newUser = {
          email: newEmail,
          password: newPassword,
          role: newRole
        };
        if (newRole === "admin") {
          const token = generateToken2();
          newUser.token = token;
          new TokenModal(this.app, token).open();
        }
        access.users.push(newUser);
        await this.plugin.saveAccessJson(access);
        new import_obsidian5.Notice(`\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C ${newEmail} \u0441\u043E\u0437\u0434\u0430\u043D`);
        this.render();
      })
    );
    containerEl.createEl("h2", { text: "\u0413\u0440\u0443\u043F\u043F\u044B", cls: "adminview-h2" });
    const groupsBox = containerEl.createDiv();
    groupsBox.className = "adminview-box";
    access.groups.forEach((group) => {
      const box = groupsBox.createDiv();
      box.style.borderBottom = "1px solid #334";
      box.style.padding = "10px 0 4px 0";
      box.createEl("h3", { text: group.name });
      access.users.forEach((u) => {
        const row = box.createDiv();
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.marginBottom = "3px";
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = group.members.includes(u.email);
        cb.onchange = async () => {
          if (cb.checked) {
            group.members.push(u.email);
          } else {
            group.members = group.members.filter((e) => e !== u.email);
          }
          await this.plugin.saveAccessJson(access);
          new import_obsidian5.Notice(`\u0413\u0440\u0443\u043F\u043F\u0430 "${group.name}" \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430`);
        };
        row.createEl("span", { text: u.email, attr: { style: "margin-left:8px;font-size:13px;" } });
      });
      new import_obsidian5.Setting(box).addButton(
        (b) => b.setButtonText("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443").setWarning().onClick(async () => {
          access.groups = access.groups.filter((g) => g !== group);
          await this.plugin.saveAccessJson(access);
          new import_obsidian5.Notice(`\u0413\u0440\u0443\u043F\u043F\u0430 "${group.name}" \u0443\u0434\u0430\u043B\u0435\u043D\u0430`);
          this.render();
        })
      );
    });
    containerEl.createEl("h3", { text: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443", attr: { style: "margin-top:20px;" } });
    let newGroupName = "";
    new import_obsidian5.Setting(containerEl).setName("\u0418\u043C\u044F \u0433\u0440\u0443\u043F\u043F\u044B").addText(
      (t) => t.setPlaceholder("\u0418\u043C\u044F \u0433\u0440\u0443\u043F\u043F\u044B").onChange((v) => newGroupName = v.trim())
    );
    new import_obsidian5.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443").setCta().onClick(async () => {
        if (!newGroupName) {
          new import_obsidian5.Notice("\u0418\u043C\u044F \u0433\u0440\u0443\u043F\u043F\u044B \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E");
          return;
        }
        if (access.groups.some((g) => g.name === newGroupName)) {
          new import_obsidian5.Notice("\u0422\u0430\u043A\u0430\u044F \u0433\u0440\u0443\u043F\u043F\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C");
          return;
        }
        access.groups.push({ name: newGroupName, members: [], permissions: {} });
        await this.plugin.saveAccessJson(access);
        new import_obsidian5.Notice(`\u0413\u0440\u0443\u043F\u043F\u0430 "${newGroupName}" \u0441\u043E\u0437\u0434\u0430\u043D\u0430`);
        this.render();
      })
    );
    containerEl.createEl("h2", { text: "\u041F\u0440\u0430\u0432\u0430 \u0433\u0440\u0443\u043F\u043F \u043D\u0430 \u0444\u0430\u0439\u043B\u044B \u0438 \u043F\u0430\u043F\u043A\u0438", cls: "adminview-h2", attr: { style: "margin-top:38px;" } });
    const allFilePaths = Array.from(getAllVaultFiles(this.app));
    const vaultTree = buildTree(allFilePaths);
    if (access.groups.length === 0) {
      containerEl.createEl("div", {
        text: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u0433\u0440\u0443\u043F\u043F\u0443, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0442\u044C \u043F\u0440\u0430\u0432\u0430.",
        attr: { style: "margin:24px 0 38px 0;font-size:1.2em;color:#aac;" }
      });
    } else if (vaultTree.length === 0) {
      containerEl.createEl("div", {
        text: "\u0412 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 \u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432 \u0434\u043B\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u0440\u0430\u0432.",
        attr: { style: "margin:24px 0 38px 0;font-size:1.2em;color:#aac;" }
      });
    } else {
      access.groups.forEach((group) => {
        const box = containerEl.createDiv();
        box.style.background = "#222c37";
        box.style.border = "1px solid #4b607a";
        box.style.marginBottom = "16px";
        box.style.padding = "48px 40px 48px 36px";
        box.style.borderRadius = "10px";
        box.style.minHeight = "420px";
        box.style.maxHeight = "1300px";
        box.style.overflowY = "auto";
        box.createEl("h3", { text: `\u0413\u0440\u0443\u043F\u043F\u0430: ${group.name}` });
        renderRightsTree(vaultTree, box, group, access, current, this.plugin, 0);
      });
    }
    containerEl.createEl("h2", { text: "Git (\u043E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438)", cls: "adminview-h2", attr: { style: "margin-top:32px;" } });
    const git = access.git || { repoUrl: "", branch: "main", authToken: "" };
    const gitBox = containerEl.createDiv();
    gitBox.className = "adminview-box";
    let gitRepoUrl = git.repoUrl || "";
    let gitBranch = git.branch || "main";
    let gitAuthToken = git.authToken || "";
    new import_obsidian5.Setting(gitBox).setName("Git URL").addText(
      (t) => t.setPlaceholder("https://github.com/...").setValue(gitRepoUrl).onChange((v) => gitRepoUrl = v)
    );
    new import_obsidian5.Setting(gitBox).setName("\u0412\u0435\u0442\u043A\u0430").addText(
      (t) => t.setPlaceholder("main").setValue(gitBranch).onChange((v) => gitBranch = v)
    );
    new import_obsidian5.Setting(gitBox).setName("\u0422\u043E\u043A\u0435\u043D (\u043F\u043E \u0436\u0435\u043B\u0430\u043D\u0438\u044E)").addText(
      (t) => t.setPlaceholder("ghp_...").setValue(gitAuthToken).onChange((v) => gitAuthToken = v)
    );
    new import_obsidian5.Setting(gitBox).addButton(
      (btn) => btn.setButtonText("\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438").setCta().onClick(async () => {
        try {
          await this.plugin.saveGitSettings({
            repoUrl: gitRepoUrl,
            branch: gitBranch,
            authToken: gitAuthToken
          });
          const vaultPath = this.app.vault.adapter.getBasePath();
          await ensureGitRepo(
            vaultPath,
            { repoUrl: gitRepoUrl, branch: gitBranch, authToken: gitAuthToken }
          );
          new import_obsidian5.Notice("Git-\u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B");
          await this.plugin.syncFromGit("pull");
        } catch (e) {
          new import_obsidian5.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 git-\u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438: " + (e?.toString() || e));
        }
      })
    ).addButton(
      (btn) => btn.setButtonText("\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0432 Git").setCta().onClick(async () => {
        try {
          await this.plugin.addUntrackedFilesAndPush();
          new import_obsidian5.Notice("\u041D\u043E\u0432\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B \u0438 \u0437\u0430\u043F\u0443\u0448\u0435\u043D\u044B");
        } catch (e) {
          new import_obsidian5.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0444\u0430\u0439\u043B\u043E\u0432: " + (e?.toString() || e));
        }
      })
    ).addButton(
      (btn) => btn.setButtonText("Pull \u0438\u0437 Git").onClick(async () => {
        await this.plugin.syncFromGit("pull");
      })
    ).addButton(
      (btn) => btn.setButtonText("Push \u0432 Git").onClick(async () => {
        await this.plugin.syncFromGit("push");
      })
    );
  }
  async onClose() {
    this.containerEl.empty();
    this.tokenValidated = false;
  }
};
function generateToken2() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let binary = "";
  for (let i = 0; i < array.byteLength; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}
function renderRightsTree(nodes, parent, group, access, current, plugin, level = 0) {
  nodes.forEach((node) => {
    const row = parent.createDiv();
    row.className = "access-tree-row";
    row.style.marginLeft = `${level * 18}px`;
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.marginBottom = "2px";
    if (node.type === "folder") {
      const arrow = row.createSpan();
      arrow.textContent = "\u25B6";
      arrow.style.cursor = "pointer";
      arrow.style.userSelect = "none";
      arrow.style.marginRight = "6px";
      arrow.style.fontSize = "13px";
      let expanded = level < 1;
      const updateArrow = () => arrow.textContent = expanded ? "\u25BC" : "\u25B6";
      updateArrow();
      row.createSpan({ text: `\u{1F4C1} ${node.name}` });
      const select = row.createEl("select");
      select.style.marginLeft = "8px";
      select.style.width = "58px";
      select.style.fontSize = "13px";
      ["none", "read", "edit", "full"].forEach((option) => {
        const opt = select.createEl("option");
        opt.value = option;
        opt.text = option;
        if ((group.permissions?.[node.path] ?? "none") === option)
          opt.selected = true;
      });
      select.onchange = async () => {
        if (!group.permissions)
          group.permissions = {};
        const value = select.value;
        group.permissions[node.path] = value;
        await plugin.saveAccessJson(access);
        new import_obsidian5.Notice(`\u041F\u0440\u0430\u0432\u0430 \u0434\u043B\u044F ${group.name} \u043D\u0430 ${node.path}: ${select.value}`);
      };
      const childrenDiv = parent.createDiv();
      childrenDiv.style.display = expanded ? "block" : "none";
      if (node.children && node.children.length) {
        renderRightsTree(node.children, childrenDiv, group, access, current, plugin, level + 1);
      }
      arrow.onclick = () => {
        expanded = !expanded;
        childrenDiv.style.display = expanded ? "block" : "none";
        updateArrow();
      };
    } else {
      row.createSpan({ text: `\u{1F4C4} ${node.name}`, attr: { style: "margin-right:3px;margin-left:6px;" } });
      const select = row.createEl("select");
      select.style.marginLeft = "8px";
      select.style.width = "58px";
      select.style.fontSize = "13px";
      ["none", "read", "edit", "full"].forEach((option) => {
        const opt = select.createEl("option");
        opt.value = option;
        opt.text = option;
        if ((group.permissions?.[node.path] ?? "none") === option)
          opt.selected = true;
      });
      select.onchange = async () => {
        if (!group.permissions)
          group.permissions = {};
        const value = select.value;
        group.permissions[node.path] = value;
        await plugin.saveAccessJson(access);
        new import_obsidian5.Notice(`\u041F\u0440\u0430\u0432\u0430 \u0434\u043B\u044F ${group.name} \u043D\u0430 ${node.path}: ${select.value}`);
      };
    }
  });
}

// src/UserView.ts
var import_obsidian6 = require("obsidian");
var UserView = class extends import_obsidian6.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return USER_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u041F\u0430\u043D\u0435\u043B\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F";
  }
  async onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    const wrapper = containerEl.createEl("div", {
      cls: "access-user-wrapper",
      attr: {
        style: `
          max-width: 540px; margin: 38px auto; padding: 28px 24px;
          background: #222c37;
          border-radius: 18px;
          box-shadow: 0 0 30px #0005;
          color: #f7fafd;
        `
      }
    });
    new import_obsidian6.Setting(wrapper).addButton(
      (btn) => btn.setButtonText("\u0412\u044B\u0439\u0442\u0438").setWarning().onClick(async () => {
        this.plugin.settings.currentUser = null;
        await this.plugin.saveSettings();
        new import_obsidian6.Notice("\u0412\u044B \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B");
        await this.leaf.detach();
      })
    );
    const access = await this.plugin.loadAccessJson();
    const current = this.plugin.settings.currentUser;
    if (!current) {
      wrapper.createEl("p", { text: "\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0432\u043E\u0439\u0434\u0438\u0442\u0435." });
      return;
    }
    const me = access.users.find((u) => u.email === current.email);
    if (!me) {
      wrapper.createEl("p", { text: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D." });
      return;
    }
    wrapper.createEl("h2", { text: `\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435, ${me.email}` });
    wrapper.createEl("div", {
      text: `\u0412\u0430\u0448\u0430 \u0440\u043E\u043B\u044C: ${me.role}`,
      attr: { style: "font-size:15px;margin-bottom:18px;color:#aaa;" }
    });
    wrapper.createEl("h3", { text: "\u0412\u0430\u0448\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B" });
    const allowedFiles = await this.getVisibleFilesForUser(me, access);
    if (allowedFiles.length === 0) {
      wrapper.createEl("p", { text: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432." });
    } else {
      const ul = wrapper.createEl("ul", { attr: { style: "margin-bottom:18px;" } });
      allowedFiles.forEach((path) => {
        const li = ul.createEl("li", { attr: { style: "margin-bottom:4px;" } });
        const link = li.createEl("a", {
          text: path,
          href: "#",
          attr: { style: "color:#76a8f8;text-decoration:underline;" }
        });
        link.onclick = (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof import_obsidian6.TFile)
            this.app.workspace.openLinkText(path, "/", true);
        };
      });
    }
    wrapper.createEl("h3", { text: "\u0412\u0430\u0448\u0438 \u0433\u0440\u0443\u043F\u043F\u044B" });
    const myGroups = access.groups.filter((g) => g.members.includes(me.email)).map((g) => g.name);
    if (myGroups.length === 0) {
      wrapper.createEl("p", { text: "\u0412\u044B \u043D\u0435 \u0441\u043E\u0441\u0442\u043E\u0438\u0442\u0435 \u043D\u0438 \u0432 \u043E\u0434\u043D\u043E\u0439 \u0433\u0440\u0443\u043F\u043F\u0435." });
    } else {
      const ul = wrapper.createEl("ul");
      myGroups.forEach((name) => ul.createEl("li", { text: name }));
    }
    wrapper.createEl("h3", { text: "\u0421\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u0430\u0440\u043E\u043B\u044C" });
    let newPw = "";
    new import_obsidian6.Setting(wrapper).addText((t) => t.setPlaceholder("\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C").onChange((v) => newPw = v));
    new import_obsidian6.Setting(wrapper).addButton(
      (btn) => btn.setButtonText("\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C").setCta().onClick(async () => {
        if (!newPw) {
          new import_obsidian6.Notice("\u041F\u0430\u0440\u043E\u043B\u044C \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u0443\u0441\u0442\u044B\u043C");
          return;
        }
        me.password = newPw;
        await this.plugin.saveAccessJson(access);
        new import_obsidian6.Notice("\u041F\u0430\u0440\u043E\u043B\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D");
      })
    );
    containerEl.createEl("h2", { text: "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0441 Git", cls: "adminview-h2", attr: { style: "margin-top:38px;" } });
    const gitBox = containerEl.createDiv();
    gitBox.className = "adminview-box";
    new import_obsidian6.Setting(gitBox).addButton(
      (btn) => btn.setButtonText("Pull \u0438\u0437 Git").onClick(async () => {
        await this.plugin.syncFromGit("pull");
      })
    ).addButton(
      (btn) => btn.setButtonText("Push \u0432 Git").onClick(async () => {
        await this.plugin.syncFromGit("push");
      })
    );
  }
  // Определение видимых файлов для пользователя (read/edit/full)
  async getVisibleFilesForUser(user, access) {
    const files = [];
    const collect = (folder) => {
      for (const child of folder.children) {
        if (child instanceof import_obsidian6.TFile)
          files.push(child.path);
        if (child instanceof import_obsidian6.TFolder)
          collect(child);
      }
    };
    collect(this.app.vault.getRoot());
    return files.filter(
      (f) => getUserPermission(user, access, f) !== "none"
    ).sort();
  }
  async onClose() {
    this.containerEl.empty();
  }
};

// src/LogModal.ts
var import_obsidian7 = require("obsidian");
var LogModal = class extends import_obsidian7.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  async onOpen() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.background = "#222c37";
    containerEl.style.borderRadius = "18px";
    containerEl.style.boxShadow = "0 0 32px #000a";
    containerEl.style.padding = "38px 28px";
    containerEl.style.color = "#fff";
    containerEl.style.maxWidth = "640px";
    containerEl.style.margin = "auto";
    containerEl.style.position = "fixed";
    containerEl.style.left = "50%";
    containerEl.style.top = "50%";
    containerEl.style.transform = "translate(-50%, -50%)";
    containerEl.style.maxHeight = "90vh";
    containerEl.style.overflowY = "auto";
    containerEl.createEl("h2", { text: "\u0416\u0443\u0440\u043D\u0430\u043B \u0441\u043E\u0431\u044B\u0442\u0438\u0439 (\u043B\u043E\u0433)" });
    const current = this.plugin.settings.currentUser;
    if (!current || current.role !== "admin") {
      containerEl.createEl("div", { text: "\u041D\u0435\u0442 \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430 \u043B\u043E\u0433\u043E\u0432." });
      return;
    }
    const events = await this.plugin.loadEventsJson();
    let filter = "";
    new import_obsidian7.Setting(containerEl).setName("\u0424\u0438\u043B\u044C\u0442\u0440 \u043F\u043E email \u0438\u043B\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044E").addText((t) => t.setPlaceholder("user@, action...").onChange((v) => {
      filter = v.trim().toLowerCase();
      renderList();
    }));
    const logBox = containerEl.createEl("div", { attr: { style: "margin-top:18px;" } });
    const renderList = () => {
      logBox.empty();
      let shown = 0;
      events.events.slice().reverse().filter(
        (e) => !filter || e.user && e.user.toLowerCase().includes(filter) || e.action && e.action.toLowerCase().includes(filter) || e.details && e.details.toLowerCase().includes(filter)
      ).forEach((e) => {
        shown++;
        const line = logBox.createEl("div", {
          attr: {
            style: `
                border-bottom:1px solid #345a;
                padding:7px 0 2px 0;
                font-size:14px;
                color:#e8f0fc;
              `
          }
        });
        line.createSpan({
          text: `${new Date(e.timestamp).toLocaleString()} | `,
          attr: { style: "color:#88d1f6;" }
        });
        line.createSpan({
          text: `[${e.user ?? "-"}] `,
          attr: { style: "color:#99b5fc;" }
        });
        line.createSpan({
          text: `${e.action}`,
          attr: { style: "color:#ffc89f;" }
        });
        if (e.details) {
          line.createSpan({
            text: ` \u2014 ${e.details}`,
            attr: { style: "color:#fff8;" }
          });
        }
      });
      if (shown === 0) {
        logBox.createEl("div", { text: "\u041D\u0435\u0442 \u0441\u043E\u0431\u044B\u0442\u0438\u0439 \u0434\u043B\u044F \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F.", attr: { style: "color:#888;padding:12px;" } });
      }
    };
    renderList();
  }
  onClose() {
    this.containerEl.empty();
  }
};

// src/main.ts
var import_child_process2 = require("child_process");
function generateEncryptionKeyBase64() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  let binary = "";
  for (let i = 0; i < array.byteLength; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}
var MyPlugin = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    this.statusBarEl = this.addStatusBarItem();
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.encryptionKey) {
      this.settings.encryptionKey = generateEncryptionKeyBase64();
      await this.saveSettings();
    }
    await this.ensureInitialAdmin();
    this.registerView(ADMIN_VIEW_TYPE, (leaf) => new AdminView(leaf, this));
    this.registerView(USER_VIEW_TYPE, (leaf) => new UserView(leaf, this));
    this.addCommand({ id: "open-panel", name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C", callback: () => this.openPanel() });
    this.addCommand({
      id: "login",
      name: "\u0412\u043E\u0439\u0442\u0438",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "L" }],
      callback: () => new LoginModal(this.app, this).open()
    });
    this.addCommand({
      id: "logout",
      name: "\u0412\u044B\u0439\u0442\u0438",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "O" }],
      callback: () => this.doLogout()
    });
    this.addCommand({
      id: "view-logs",
      name: "\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u043B\u043E\u0433\u043E\u0432",
      callback: async () => {
        if (this.settings.currentUser?.role === "admin") {
          new LogModal(this.app, this).open();
        } else
          new import_obsidian8.Notice("\u0414\u043E\u0441\u0442\u0443\u043F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D");
      }
    });
    this.addCommand({
      id: "git-pull",
      name: "Pull \u0438\u0437 Git",
      callback: async () => {
        await this.syncFromGit("pull");
      }
    });
    this.addCommand({
      id: "git-push",
      name: "Push \u0432 Git",
      callback: async () => {
        await this.syncFromGit("push");
      }
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", async () => {
      await this.updateStatusBarWithFileAccess();
    }));
    this.updateStatusBarWithFileAccess();
  }
  async openPanel() {
    if (!this.settings.currentUser) {
      new LoginModal(this.app, this).open();
    } else {
      const user = this.settings.currentUser;
      if (user.role === "admin")
        this.openAdminView();
      else
        this.openUserView();
    }
  }
  async doLogout() {
    this.settings.currentUser = null;
    await this.saveSettings();
    new import_obsidian8.Notice("\u0412\u044B \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B");
    this.app.workspace.detachLeavesOfType(ADMIN_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(USER_VIEW_TYPE);
    this.updateStatusBarWithFileAccess();
  }
  async updateStatusBarWithFileAccess() {
    const leaf = this.app.workspace.activeLeaf;
    let accessText = "";
    let userText = "";
    if (this.settings.currentUser) {
      userText = `\u{1F511} ${this.settings.currentUser.email} (${this.settings.currentUser.role})`;
    } else {
      userText = "\u{1F512} \u041D\u0435 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u043D\u043E";
    }
    if (leaf && leaf.view.file) {
      const file = leaf.view.file;
      const access = await this.loadAccessJson();
      let perm = "none";
      if (this.settings.currentUser) {
        perm = getUserPermission(this.settings.currentUser, access, file.path);
      }
      accessText = perm === "edit" || perm === "full" ? "\u270F\uFE0F \u041C\u043E\u0436\u043D\u043E \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" : perm === "read" ? "\u{1F512} \u0422\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435" : "\u26D4 \u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430";
    }
    this.statusBarEl.setText(
      `${userText}${accessText ? " | " + accessText : ""}`
    );
    this.statusBarEl.onclick = () => {
      if (this.settings.currentUser)
        this.doLogout();
      else
        new LoginModal(this.app, this).open();
    };
  }
  async ensureInitialAdmin() {
    const a = await this.loadAccessJson();
    if (!this.settings.firstAdminSetupDone && a.users.length === 0) {
      new SetupAdminModal(this.app, this).open();
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    await this.updateStatusBarWithFileAccess();
  }
  async loadAccessJson() {
    if (!this.settings.encryptionKey) {
      throw new Error("\u041A\u043B\u044E\u0447 \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442");
    }
    return await loadAndDecryptAccessJson(this.app, this.settings.encryptionKey);
  }
  async saveAccessJson(d) {
    if (!this.settings.encryptionKey) {
      throw new Error("\u041A\u043B\u044E\u0447 \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442");
    }
    await encryptAndSaveAccessJson(this.app, this.settings.encryptionKey, d);
  }
  async loadGitSettings() {
    const access = await this.loadAccessJson();
    return access.git || { repoUrl: "", branch: "main", authToken: "" };
  }
  async saveGitSettings(newGit) {
    const access = await this.loadAccessJson();
    access.git = newGit;
    await this.saveAccessJson(access);
  }
  async loadEventsJson() {
    const path = "events.json";
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian8.TFile) {
      return JSON.parse(await this.app.vault.read(f));
    }
    const empty = { events: [] };
    await this.saveEventsJson(empty);
    return empty;
  }
  async saveEventsJson(d) {
    await safeCreateOrUpdateFile(this.app, "events.json", JSON.stringify(d, null, 2));
  }
  openAdminView() {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf)
      leaf.setViewState({ type: ADMIN_VIEW_TYPE, active: true });
  }
  openUserView() {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf)
      leaf.setViewState({ type: USER_VIEW_TYPE, active: true });
  }
  async canAccess(path) {
    if (!this.settings.currentUser)
      return false;
    const access = await this.loadAccessJson();
    return getUserPermission(this.settings.currentUser, access, path) !== "none";
  }
  async filterFilesByAccess() {
    const access = await this.loadAccessJson();
    const user = this.settings.currentUser;
    if (!user)
      return;
    const files = Array.from(getAllVaultFiles(this.app));
    for (const filePath of files) {
      const perm = getUserPermission(user, access, filePath);
      if (perm === "none") {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof import_obsidian8.TFile) {
          try {
            await this.app.vault.delete(file);
          } catch {
          }
        }
      }
    }
  }
  // Метод для полного пуша всех файлов (в админке)
  async pushAllFiles() {
    const git = await this.loadGitSettings();
    if (!git.repoUrl) {
      new import_obsidian8.Notice("Git-\u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u0439 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D");
      return;
    }
    const vaultPath = this.app.vault.adapter.getBasePath();
    try {
      await execGitCommand("git add -A", vaultPath);
      try {
        await execGitCommand('git commit -m "Full vault sync"', vaultPath);
      } catch {
      }
      await execGitCommand(`git push origin ${git.branch}`, vaultPath);
      new import_obsidian8.Notice("\u041F\u043E\u043B\u043D\u044B\u0439 \u043F\u0443\u0448 \u0432\u0441\u0435\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D!");
    } catch (e) {
      new import_obsidian8.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u043D\u043E\u0433\u043E \u043F\u0443\u0448\u0430: " + e.toString());
    }
  }
  // Обычный пуш с проверкой прав
  async syncFromGit(action) {
    const git = await this.loadGitSettings();
    if (!git.repoUrl) {
      new import_obsidian8.Notice("Git-\u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u0439 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D");
      return;
    }
    const vaultPath = this.app.vault.adapter.getBasePath();
    try {
      await execGitCommand("git rev-parse --is-inside-work-tree", vaultPath);
    } catch {
      await execGitCommand("git init", vaultPath);
      await execGitCommand(
        `git remote add origin ${git.repoUrl} || git remote set-url origin ${git.repoUrl}`,
        vaultPath
      );
      await execGitCommand(`git fetch origin`, vaultPath);
      await execGitCommand(`git checkout -B ${git.branch}`, vaultPath);
    }
    if (action === "pull") {
      try {
        await execGitCommand(`git pull origin ${git.branch}`, vaultPath);
        new import_obsidian8.Notice("Git pull \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D!");
        await this.filterFilesByAccess();
      } catch (e) {
        new import_obsidian8.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 pull: " + e.toString());
      }
    } else if (action === "push") {
      const access = await this.loadAccessJson();
      const user = this.settings.currentUser;
      if (!user) {
        new import_obsidian8.Notice("\u041D\u0435\u0442 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438 \u2014 push \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u0435\u043D!");
        return;
      }
      const files = Array.from(getAllVaultFiles(this.app));
      let allowedFiles;
      if (user.role === "admin") {
        await this.pushAllFiles();
        return;
      } else {
        allowedFiles = files.filter((f) => {
          const perm = getUserPermission(user, access, f);
          return perm === "edit" || perm === "full";
        });
      }
      if (allowedFiles.length === 0) {
        new import_obsidian8.Notice("\u041D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432 \u0434\u043B\u044F \u043F\u0443\u0448\u0430");
        return;
      }
      const gitFiles = allowedFiles.map((f) => `"${f}"`).join(" ");
      try {
        await execGitCommand(`git add ${gitFiles}`, vaultPath);
        try {
          await execGitCommand(`git commit -m "Sync"`, vaultPath);
        } catch {
        }
        await execGitCommand(`git push origin ${git.branch}`, vaultPath);
        new import_obsidian8.Notice("Git push \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D!");
      } catch (e) {
        new import_obsidian8.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 push: " + e.toString());
      }
    }
  }
  async addUntrackedFilesAndPush() {
    const vaultPath = this.app.vault.adapter.getBasePath();
    let result;
    try {
      result = await execGitCommand("git status --porcelain", vaultPath);
    } catch (e) {
      throw new Error("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0441\u0442\u0430\u0442\u0443\u0441\u0430 git: " + e.toString());
    }
    const status = result.stdout;
    const untrackedFiles = status.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("??")).map((line) => line.slice(3).trim()).filter((f) => f.length > 0);
    if (untrackedFiles.length === 0) {
      throw new Error("\u041D\u0435\u0442 \u043D\u043E\u0432\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F");
    }
    try {
      await execGitCommand(`git add ${untrackedFiles.map((f) => `"${f}"`).join(" ")}`, vaultPath);
      await execGitCommand(`git commit -m "Add new files"`, vaultPath);
      const gitSettings = await this.loadGitSettings();
      await execGitCommand(`git push origin ${gitSettings.branch}`, vaultPath);
    } catch (e) {
      throw new Error("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438, \u043A\u043E\u043C\u043C\u0438\u0442\u0435 \u0438\u043B\u0438 \u043F\u0443\u0448\u0435: " + e.toString());
    }
  }
  async initializeGitRepoIfNeeded() {
    const git = await this.loadGitSettings();
    if (!git.repoUrl)
      return;
    const vaultPath = this.app.vault.adapter.getBasePath();
    const authPart = git.authToken ? git.authToken + "@" : "";
    const remote = git.repoUrl.replace("https://", `https://${authPart}`);
    (0, import_child_process2.exec)(`cd "${vaultPath}" && git rev-parse --is-inside-work-tree`, (err, stdout, stderr) => {
      if (err) {
        (0, import_child_process2.exec)(`cd "${vaultPath}" && git init && git remote add origin ${remote} && git pull origin ${git.branch}`, (err2, stdout2, stderr2) => {
          if (err2) {
            new import_obsidian8.Notice("\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 Git: " + stderr2);
          } else {
            new import_obsidian8.Notice("Git-\u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u0439 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D!");
          }
        });
      }
    });
  }
};
