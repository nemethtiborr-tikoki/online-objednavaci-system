const app = document.querySelector("#app");

let state = {
  user: null,
  products: [],
  orders: [],
  customers: [],
  announcements: [],
  emailSettings: null,
  view: "home",
  selectedOrderId: null,
  orderFilterOpen: false,
  orderFilters: {
    query: "",
    status: "",
    dateFrom: "",
    dateTo: "",
    minWeight: "",
    maxWeight: "",
    minTotal: "",
    maxTotal: ""
  },
  orderSort: { key: "date", direction: "desc" },
  productFilterOpen: false,
  productFilters: {
    query: "",
    active: "",
    minWeight: "",
    maxWeight: "",
    minPrice: "",
    maxPrice: ""
  },
  productSort: { key: "cardNumber", direction: "asc" },
  message: "",
  error: "",
  printOrder: null
};

const money = value => `${Number(value || 0).toFixed(2)} EUR`;
const dateTime = value => new Date(value).toLocaleString("sk-SK");
const ORDER_STATUSES = [
  ["nova", "nova objednavka"],
  ["spracovava_sa", "spracovava sa"],
  ["vybavena", "vybavena"]
];
const ANNOUNCEMENT_CATEGORIES = [
  ["upozornenie", "Upozornenie"],
  ["novinka", "Novinka"],
  ["ponuka", "Ponuka"],
  ["ine", "Informacia"]
];
const announcementCategoryLabel = category => ANNOUNCEMENT_CATEGORIES.find(([value]) => value === category)?.[1] || "Informacia";
const orderStatusLabel = status => {
  if (status === "spracovana") return "spracovava sa";
  return ORDER_STATUSES.find(([value]) => value === status)?.[1] || status || "nova objednavka";
};
const orderStatusClass = status => status === "spracovava_sa" || status === "spracovana" ? "spracovava-sa" : status;
const orderTotal = order => order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
const orderWeight = order => order.items.reduce((sum, item) => sum + item.quantity * item.weight, 0);
const weightText = value => `${Number(value || 0).toFixed(2)} kg`;
const defaultOrderFilters = () => ({
  query: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  minWeight: "",
  maxWeight: "",
  minTotal: "",
  maxTotal: ""
});
const defaultProductFilters = () => ({
  query: "",
  active: "",
  minWeight: "",
  maxWeight: "",
  minPrice: "",
  maxPrice: ""
});
const escapeHtml = value => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() || "Server nevratil platnu odpoved." };
  if (!response.ok) throw new Error(data.error || "Akcia sa nepodarila.");
  return data;
}

function setMessage(message, error = "") {
  state.message = message;
  state.error = error;
  render();
}

async function loadSession() {
  const { user } = await api("/api/me");
  state.user = user;
  if (user) {
    if (user.role === "admin" && state.view === "home") state.view = "dashboard";
    await refreshData();
  }
  render();
}

async function refreshData() {
  const requests = [
    api("/api/products"),
    api("/api/orders"),
    api("/api/announcements")
  ];
  if (state.user?.role === "admin") {
    requests.push(api("/api/customers"));
    requests.push(api("/api/settings/email"));
  }
  const [productsData, ordersData, announcementsData, customersData, settingsData] = await Promise.all(requests);
  state.products = productsData.products;
  state.orders = ordersData.orders;
  state.announcements = announcementsData.announcements;
  state.customers = customersData?.customers || [];
  state.emailSettings = settingsData?.settings || null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function render() {
  app.innerHTML = "";
  if (!state.user) {
    app.append(renderLogin());
    return;
  }
  app.append(renderShell());
}

function renderLogin() {
  const form = el("form", { class: "login-panel grid" });
  form.innerHTML = `
    <div class="login-heading">
      <img class="login-logo" src="/assets/cornico-logo.png" alt="CORNiCO Snack Food Service" onerror="this.hidden=true">
      <h1>Objednávkový systém CORNiCO</h1>
      <p class="muted">Prihlasenie zakaznika alebo administratora.</p>
    </div>
    <label>Prihlasovacie meno<input name="username" autocomplete="username" required></label>
    <label>Heslo<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Prihlasit sa</button>
    <p class="message error"></p>
  `;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const { user } = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.user = user;
      state.view = user.role === "admin" ? "dashboard" : "home";
      await refreshData();
      setMessage("");
    } catch (error) {
      form.querySelector(".error").textContent = error.message;
    }
  });
  return el("main", { class: "login-screen" }, form);
}

function renderShell() {
  const shell = el("div", { class: "app-shell" });
  const navItems = state.user.role === "admin"
    ? [["dashboard", "Prehlad"], ["announcements", "Obsah pre zakaznikov"], ["orders", "Historia objednavok"], ["products", "Tovarove polozky"], ["customers", "Zakaznici"], ["settings", "Nastavenia"]]
    : [["home", "Informacie"], ["order", "Nova objednavka"], ["my-orders", "Moje objednavky"], ["profile", "Moj profil"]];

  shell.append(
    el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [
        el("img", { class: "brand-logo", src: "/assets/cornico-logo.png", alt: "CORNiCO", onerror: event => event.currentTarget.hidden = true }),
        el("span", { class: "brand-title", text: "Objednávkový systém CORNiCO" })
      ]),
      el("div", { class: "userbar" }, [
        `${state.user.name} (${state.user.role === "admin" ? "administrator" : "zakaznik"})`,
        el("button", { class: "secondary", onclick: logout, text: "Odhlasit" })
      ])
    ])
  );

  const sidebar = el("aside", { class: "sidebar" });
  for (const [view, label] of navItems) {
    sidebar.append(el("button", {
      class: `nav-button ${state.view === view ? "active" : ""}`,
      text: label,
      onclick: async () => {
        state.view = view;
        if (view !== "orders") state.selectedOrderId = null;
        state.message = "";
        state.error = "";
        if (view === "my-orders") {
          try {
            const { orders } = await api("/api/orders");
            state.orders = orders;
          } catch (error) {
            state.error = error.message;
          }
        }
        if (view === "home" || view === "announcements") {
          try {
            const { announcements } = await api("/api/announcements");
            state.announcements = announcements;
          } catch (error) {
            state.error = error.message;
          }
        }
        render();
      }
    }));
  }

  const main = el("main", { class: "main" });
  if (state.view === "dashboard") main.append(renderAdminDashboard());
  if (state.view === "home") main.append(renderCustomerHome());
  if (state.view === "announcements") main.append(renderAnnouncementsAdmin());
  if (state.view === "order") main.append(renderCustomerOrder());
  if (state.view === "my-orders") main.append(renderOrders(false));
  if (state.view === "orders") main.append(renderOrders(true));
  if (state.view === "products") main.append(renderProductsAdmin());
  if (state.view === "customers") main.append(renderCustomersAdmin());
  if (state.view === "settings") main.append(renderEmailSettings());
  if (state.view === "profile") main.append(renderProfile());
  if (state.printOrder) main.append(renderPrintOrder(state.printOrder));

  shell.append(el("div", { class: "layout" }, [sidebar, main]));
  return shell;
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  state = {
    user: null,
    products: [],
    orders: [],
    customers: [],
    announcements: [],
    emailSettings: null,
    view: "home",
    selectedOrderId: null,
    orderFilterOpen: false,
    orderFilters: defaultOrderFilters(),
    orderSort: { key: "date", direction: "desc" },
    productFilterOpen: false,
    productFilters: defaultProductFilters(),
    productSort: { key: "cardNumber", direction: "asc" },
    message: "",
    error: "",
    printOrder: null
  };
  render();
}

function renderAnnouncementItem(announcement, isAdmin = false) {
  const actions = [];
  if (isAdmin) {
    actions.push(el("button", {
      class: "secondary",
      text: announcement.published ? "Skryt" : "Zverejnit",
      onclick: async () => {
        try {
          await api(`/api/announcements/${announcement.id}`, {
            method: "PUT",
            body: JSON.stringify({ published: !announcement.published })
          });
          const { announcements } = await api("/api/announcements");
          state.announcements = announcements;
          setMessage(announcement.published ? "Informacia bola skryta, v historii zostava zachovana." : "Informacia bola znovu zverejnena.");
        } catch (error) {
          setMessage("", error.message);
        }
      }
    }));
  }

  return el("article", { class: `announcement-item announcement-${announcement.category} ${announcement.published ? "" : "announcement-hidden"}` }, [
    el("div", { class: "announcement-meta" }, [
      el("span", { class: `announcement-category category-${announcement.category}`, text: announcementCategoryLabel(announcement.category) }),
      el("time", { datetime: announcement.createdAt, text: dateTime(announcement.createdAt) }),
      isAdmin && !announcement.published ? el("span", { class: "status zrusena", text: "skryta" }) : ""
    ]),
    el("div", { class: "announcement-heading" }, [
      el("h2", { text: announcement.title }),
      actions.length ? el("div", { class: "actions" }, actions) : ""
    ]),
    el("p", { class: "announcement-content", text: announcement.content }),
    isAdmin ? el("div", { class: "announcement-author muted", text: `Zverejnil: ${announcement.authorName}` }) : ""
  ]);
}

function renderCustomerHome() {
  const container = el("section", { class: "grid" }, [
    pageTitle("Informacie", "Upozornenia, novinky a aktualne ponuky."),
    renderNotice()
  ]);
  if (!state.announcements.length) {
    container.append(el("div", { class: "panel muted", text: "Aktualne nie su zverejnene ziadne informacie." }));
    return container;
  }
  const feed = el("div", { class: "announcement-feed" });
  for (const announcement of state.announcements) feed.append(renderAnnouncementItem(announcement));
  container.append(feed);
  return container;
}

function renderAnnouncementsAdmin() {
  const form = el("form", { class: "panel form-grid" });
  form.innerHTML = `
    <label class="span-2">Typ informacie
      <select name="category">
        ${ANNOUNCEMENT_CATEGORIES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
      </select>
    </label>
    <label class="span-6">Nadpis
      <input name="title" required maxlength="160">
    </label>
    <label class="span-6">Text
      <textarea name="content" required maxlength="10000"></textarea>
    </label>
    <div class="span-6 actions">
      <button type="submit">Zverejnit informaciu</button>
    </div>
  `;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/announcements", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const { announcements } = await api("/api/announcements");
      state.announcements = announcements;
      form.reset();
      setMessage("Informacia bola zverejnena.");
    } catch (error) {
      setMessage("", error.message);
    }
  });

  const container = el("section", { class: "grid" }, [
    pageTitle("Obsah pre zakaznikov", "Publikovanie a historia informacii."),
    renderNotice(),
    form,
    el("div", { class: "section-heading" }, [
      el("h2", { text: "Historia" }),
      el("span", { class: "muted", text: `${state.announcements.length} zaznamov` })
    ])
  ]);
  if (!state.announcements.length) {
    container.append(el("div", { class: "panel muted", text: "Historia je zatial prazdna." }));
    return container;
  }
  const history = el("div", { class: "announcement-feed" });
  for (const announcement of state.announcements) history.append(renderAnnouncementItem(announcement, true));
  container.append(history);
  return container;
}

function renderCustomerOrder() {
  const quantities = new Map();
  const note = el("textarea", { placeholder: "Volitelna poznamka k objednavke" });
  const tbody = el("tbody");
  const totalQuantity = el("strong", { text: "0" });
  const totalWeight = el("strong", { text: weightText(0) });
  const totalPrice = el("strong", { text: money(0) });

  for (const product of state.products) {
    const quantity = el("input", { class: "number-input", type: "number", min: "0", step: "1", value: "0" });
    const lineWeight = el("td", { class: "line-total", text: weightText(0) });
    const linePrice = el("td", { class: "line-total", text: money(0) });
    const row = el("tr", {}, [
      el("td", { text: product.cardNumber }),
      el("td", { text: product.name }),
      el("td", { text: product.unit }),
      el("td", { text: weightText(product.weight) }),
      el("td", { text: money(product.price) }),
      el("td", {}, quantity),
      lineWeight,
      linePrice
    ]);
    quantities.set(product.id, { input: quantity, product, lineWeight, linePrice, row });
    tbody.append(row);
  }

  const updateTotals = () => {
    let quantitySum = 0;
    let weightSum = 0;
    let priceSum = 0;
    for (const { input, product, lineWeight, linePrice, row } of quantities.values()) {
      const quantity = Math.max(0, Math.trunc(Number(input.value || 0)));
      const weight = quantity * Number(product.weight || 0);
      const price = quantity * Number(product.price || 0);
      quantitySum += quantity;
      weightSum += weight;
      priceSum += price;
      lineWeight.textContent = weightText(weight);
      linePrice.textContent = money(price);
      row.classList.toggle("selected-order-row", quantity > 0);
    }
    totalQuantity.textContent = String(quantitySum);
    totalWeight.textContent = weightText(weightSum);
    totalPrice.textContent = money(priceSum);
  };

  for (const { input } of quantities.values()) {
    input.addEventListener("input", updateTotals);
    input.addEventListener("blur", () => {
      input.value = String(Math.max(0, Math.trunc(Number(input.value || 0))));
      updateTotals();
    });
  }

  const tfoot = el("tfoot", {}, el("tr", { class: "order-total-row" }, [
    el("td", { colspan: "5", text: "Spolu" }),
    el("td", {}, totalQuantity),
    el("td", {}, totalWeight),
    el("td", {}, totalPrice)
  ]));

  const form = el("form", { class: "grid" }, [
    pageTitle("Nova objednavka", "Vyplnte mnozstva pri tovare, ktory chcete objednat."),
    el("div", { class: "table-wrap" }, el("table", {}, [
      tableHead(["Cislo karty", "Nazov", "MJ", "Hmotnost/ks", "Cena/ks", "Mnozstvo", "Hmotnost spolu", "Cena spolu"]),
      tbody,
      tfoot
    ])),
    el("label", {}, ["Poznamka", note]),
    el("div", { class: "summary" }, [
      el("span", { class: "muted", text: "Po odoslani sa vytvori zaznam e-mailu pre zakaznika aj administratora." }),
      el("button", { type: "submit", text: "Odoslat objednavku" })
    ]),
    renderNotice()
  ]);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const items = [...quantities.entries()].map(([productId, { input }]) => ({
      productId,
      quantity: Math.trunc(Number(input.value || 0))
    }));
    try {
      const { email } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ note: note.value, items })
      });
      await refreshData();
      state.view = "my-orders";
      if (email?.sent) setMessage("Objednavka bola odoslana a potvrdenie bolo poslane e-mailom.");
      else if (email?.configured) setMessage("Objednavka bola ulozena, ale e-mail sa nepodarilo odoslat. Administrator moze skontrolovat nastavenia e-mailu.");
      else setMessage("Objednavka bola odoslana. E-mailove odosielanie zatial nie je zapnute.");
    } catch (error) {
      setMessage("", error.message);
    }
  });

  return form;
}

function renderOrders(isAdmin) {
  const container = el("section", { class: "grid" }, [
    pageTitle(isAdmin ? "Historia objednavok" : "Moje objednavky", isAdmin ? "Prehlad, uprava a tlac objednavok." : "Prehlad odoslanych objednavok."),
    renderNotice()
  ]);

  if (!state.orders.length) {
    container.append(el("div", { class: "panel muted", text: "Zatial tu nie su ziadne objednavky." }));
    return container;
  }

  if (isAdmin) {
    const visibleOrders = filteredSortedAdminOrders();
    container.append(renderOrderFilters(visibleOrders.length));
    container.append(renderAdminOrderList(visibleOrders));
    const selectedOrder = state.orders.find(order => order.id === state.selectedOrderId);
    if (selectedOrder) {
      container.append(renderOrderPanel(selectedOrder, true));
    }
    return container;
  }

  const tbody = el("tbody");
  for (const order of state.orders) {
    tbody.append(el("tr", {}, [
      el("td", { text: order.number }),
      el("td", { text: dateTime(order.createdAt) }),
      el("td", {}, el("button", {
        class: state.selectedOrderId === order.id ? "" : "secondary",
        text: state.selectedOrderId === order.id ? "Zatvorit" : "Otvorit",
        onclick: () => {
          state.selectedOrderId = state.selectedOrderId === order.id ? null : order.id;
          render();
        }
      }))
    ]));
  }
  container.append(el("div", { class: "table-wrap customer-orders" }, el("table", {}, [
    tableHead(["Cislo objednavky", "Datum a cas", "Objednavka"]),
    tbody
  ])));
  const selectedOrder = state.orders.find(order => order.id === state.selectedOrderId);
  if (selectedOrder) container.append(renderOrderPanel(selectedOrder, false));
  return container;
}

function orderSearchText(order) {
  const profile = order.customerProfile || {};
  const itemText = order.items
    .map(item => [
      item.cardNumber,
      item.name,
      item.unit,
      item.weight,
      item.price,
      item.quantity,
      item.quantity * item.weight,
      item.quantity * item.price
    ].join(" "))
    .join(" ");
  return [
    order.number,
    order.customerName,
    order.customerEmail,
    profile.companyName,
    profile.companyId,
    profile.taxId,
    profile.vatId,
    profile.phone,
    profile.orderingPerson,
    profile.operationName,
    profile.address,
    orderStatusLabel(order.status),
    order.status,
    order.note,
    dateTime(order.createdAt),
    dateTime(order.updatedAt),
    orderWeight(order),
    orderTotal(order),
    itemText
  ].join(" ").toLowerCase();
}

function filteredSortedAdminOrders() {
  const filters = state.orderFilters;
  const query = filters.query.trim().toLowerCase();
  const dateFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
  const dateTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`) : null;
  const minWeight = filters.minWeight === "" ? null : Number(filters.minWeight);
  const maxWeight = filters.maxWeight === "" ? null : Number(filters.maxWeight);
  const minTotal = filters.minTotal === "" ? null : Number(filters.minTotal);
  const maxTotal = filters.maxTotal === "" ? null : Number(filters.maxTotal);

  return [...state.orders]
    .filter(order => {
      const createdAt = new Date(order.createdAt);
      const weight = orderWeight(order);
      const total = orderTotal(order);
      if (query && !orderSearchText(order).includes(query)) return false;
      if (filters.status && order.status !== filters.status) return false;
      if (dateFrom && createdAt < dateFrom) return false;
      if (dateTo && createdAt > dateTo) return false;
      if (minWeight !== null && weight < minWeight) return false;
      if (maxWeight !== null && weight > maxWeight) return false;
      if (minTotal !== null && total < minTotal) return false;
      if (maxTotal !== null && total > maxTotal) return false;
      return true;
    })
    .sort((a, b) => compareOrders(a, b, state.orderSort.key) * (state.orderSort.direction === "asc" ? 1 : -1));
}

function compareOrders(a, b, key) {
  const values = {
    number: [a.number, b.number],
    customer: [a.customerName, b.customerName],
    date: [new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime()],
    status: [orderStatusLabel(a.status), orderStatusLabel(b.status)],
    weight: [orderWeight(a), orderWeight(b)],
    total: [orderTotal(a), orderTotal(b)]
  }[key] || [a.number, b.number];
  if (typeof values[0] === "number" && typeof values[1] === "number") return values[0] - values[1];
  return String(values[0] || "").localeCompare(String(values[1] || ""), "sk", { numeric: true, sensitivity: "base" });
}

function renderOrderFilters(count) {
  const panel = el("section", { class: "panel grid" });
  panel.append(el("div", { class: "toolbar" }, [
    el("div", {}, [
      el("strong", { text: "Filter objednavok" }),
      el("div", { class: "muted", text: `Zobrazenych ${count} z ${state.orders.length}` })
    ]),
    el("button", {
      class: "secondary",
      text: state.orderFilterOpen ? "Skryt filter" : "Rozbalit filter",
      onclick: () => {
        state.orderFilterOpen = !state.orderFilterOpen;
        render();
      }
    })
  ]));

  if (!state.orderFilterOpen) return panel;

  const filters = state.orderFilters;
  const form = el("form", { class: "form-grid" });
  form.innerHTML = `
    <label class="span-6">Vyhladavanie vo vsetkych udajoch objednavky
      <input name="query" value="${escapeHtml(filters.query)}" placeholder="cislo, zakaznik, prevadzka, tovar, poznamka, suma...">
    </label>
    <label class="span-2">Stav
      <select name="status">
        <option value="">vsetky</option>
        ${ORDER_STATUSES.map(([value, label]) => `<option value="${value}" ${filters.status === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label class="span-2">Datum od<input name="dateFrom" type="date" value="${escapeHtml(filters.dateFrom)}"></label>
    <label class="span-2">Datum do<input name="dateTo" type="date" value="${escapeHtml(filters.dateTo)}"></label>
    <label class="span-2">Hmotnost od<input name="minWeight" type="number" step="0.01" value="${escapeHtml(filters.minWeight)}"></label>
    <label class="span-2">Hmotnost do<input name="maxWeight" type="number" step="0.01" value="${escapeHtml(filters.maxWeight)}"></label>
    <label class="span-2">Suma od<input name="minTotal" type="number" step="0.01" value="${escapeHtml(filters.minTotal)}"></label>
    <label class="span-2">Suma do<input name="maxTotal" type="number" step="0.01" value="${escapeHtml(filters.maxTotal)}"></label>
    <div class="span-6 actions">
      <button type="submit">Pouzit filter</button>
      <button class="secondary" type="button" data-reset="true">Vycistit filter</button>
    </div>
  `;
  form.addEventListener("submit", event => {
    event.preventDefault();
    state.orderFilters = Object.fromEntries(new FormData(form));
    state.selectedOrderId = null;
    render();
  });
  form.querySelector("[data-reset]").addEventListener("click", () => {
    state.orderFilters = defaultOrderFilters();
    state.selectedOrderId = null;
    render();
  });
  panel.append(form);
  return panel;
}

function renderAdminDashboard() {
  const newOrders = state.orders.filter(order => order.status === "nova");
  const totalNewValue = newOrders.reduce((sum, order) => sum + orderTotal(order), 0);
  const totalNewWeight = newOrders.reduce((sum, order) => sum + orderWeight(order), 0);
  const container = el("section", { class: "grid" }, [
    pageTitle("Prehlad", "Jednoduchy sumar novych objednavok."),
    renderNotice(),
    el("div", { class: "dashboard-grid" }, [
      el("div", { class: "panel metric" }, [
        el("span", { class: "muted", text: "Nove objednavky" }),
        el("strong", { text: newOrders.length })
      ]),
      el("div", { class: "panel metric" }, [
        el("span", { class: "muted", text: "Hodnota novych objednavok" }),
        el("strong", { text: money(totalNewValue) })
      ]),
      el("div", { class: "panel metric" }, [
        el("span", { class: "muted", text: "Hmotnost novych objednavok" }),
        el("strong", { text: weightText(totalNewWeight) })
      ])
    ])
  ]);

  if (!newOrders.length) {
    container.append(el("div", { class: "panel muted", text: "Aktualne nie su ziadne nove objednavky." }));
    return container;
  }

  const tbody = el("tbody");
  for (const order of newOrders) {
    tbody.append(el("tr", {}, [
      el("td", { text: order.number }),
      el("td", {}, [
        el("strong", { text: order.customerName }),
        el("div", { class: "muted", text: order.customerProfile?.operationName || order.customerEmail })
      ]),
      el("td", { text: dateTime(order.createdAt) }),
      el("td", { text: weightText(orderWeight(order)) }),
      el("td", { text: money(orderTotal(order)) }),
      el("td", {}, el("button", {
        text: "Otvorit",
        onclick: () => {
          state.view = "orders";
          state.selectedOrderId = order.id;
          state.message = "";
          state.error = "";
          render();
        }
      }))
    ]));
  }

  container.append(el("div", { class: "table-wrap" }, el("table", {}, [
    tableHead(["Cislo", "Zakaznik", "Datum", "Hmotnost", "Suma", "Objednavka"]),
    tbody
  ])));
  return container;
}

function renderAdminOrderList(orders) {
  const tbody = el("tbody");
  for (const order of orders) {
    tbody.append(el("tr", {}, [
      el("td", { text: order.number }),
      el("td", {}, [
        el("strong", { text: order.customerName }),
        el("div", { class: "muted", text: order.customerProfile?.operationName || order.customerEmail })
      ]),
      el("td", { text: dateTime(order.createdAt) }),
      el("td", {}, el("span", { class: `status ${orderStatusClass(order.status)}`, text: orderStatusLabel(order.status) })),
      el("td", { text: weightText(orderWeight(order)) }),
      el("td", { text: money(orderTotal(order)) }),
      el("td", {}, el("button", {
        class: state.selectedOrderId === order.id ? "" : "secondary",
        text: state.selectedOrderId === order.id ? "Otvorena" : "Otvorit",
        onclick: () => {
          state.selectedOrderId = order.id;
          state.message = "";
          state.error = "";
          render();
        }
      }))
    ]));
  }

  if (!orders.length) {
    tbody.append(el("tr", {}, el("td", { colspan: "7", class: "muted", text: "Filtru nevyhovuje ziadna objednavka." })));
  }

  return el("div", { class: "table-wrap" }, el("table", {}, [
    sortableOrderHead(),
    tbody
  ]));
}

function sortableOrderHead() {
  const columns = [
    ["number", "Cislo"],
    ["customer", "Zakaznik"],
    ["date", "Datum"],
    ["status", "Stav"],
    ["weight", "Hmotnost"],
    ["total", "Suma"]
  ];
  return el("thead", {}, el("tr", {}, [
    ...columns.map(([key, label]) => {
      const active = state.orderSort.key === key;
      const direction = active ? (state.orderSort.direction === "asc" ? " ▲" : " ▼") : "";
      return el("th", {}, el("button", {
        class: `sort-button ${active ? "active" : ""}`,
        text: `${label}${direction}`,
        onclick: () => {
          if (state.orderSort.key === key) {
            state.orderSort.direction = state.orderSort.direction === "asc" ? "desc" : "asc";
          } else {
            state.orderSort = { key, direction: key === "date" ? "desc" : "asc" };
          }
          render();
        }
      }));
    }),
    el("th", { text: "Objednavka" })
  ]));
}

function renderOrderPanel(order, isAdmin) {
  const status = el("select");
  for (const [value, label] of ORDER_STATUSES) {
    status.append(el("option", { value, text: label }));
  }
  status.value = order.status === "spracovana" ? "spracovava_sa" : order.status;
  const note = el("textarea", {}, order.note || "");

  const tbody = el("tbody");
  for (const item of order.items) {
    const quantity = el("input", { class: "number-input", type: "number", min: "0", step: "1", value: Math.trunc(item.quantity) });
    quantity.dataset.itemId = item.productId;
    tbody.append(el("tr", {}, [
      el("td", { text: item.cardNumber }),
      el("td", { text: item.name }),
      el("td", { text: item.unit }),
      el("td", { text: weightText(item.weight) }),
      el("td", { text: money(item.price) }),
      el("td", {}, isAdmin ? quantity : String(item.quantity)),
      el("td", { text: weightText(item.quantity * item.weight) }),
      el("td", { text: money(item.quantity * item.price) })
    ]));
  }

  const actions = el("div", { class: "actions" }, [
    el("button", {
      class: "secondary",
      text: "Tlacit",
      onclick: () => printOrder(order)
    })
  ]);

  if (isAdmin) {
    actions.prepend(el("button", {
      text: "Ulozit zmeny",
      onclick: async () => {
        const rows = [...tbody.querySelectorAll("tr")];
        const items = rows.map((row, index) => ({ ...order.items[index], quantity: Math.trunc(Number(row.querySelector("input").value || 0)) }));
        try {
          await api(`/api/orders/${order.id}`, {
            method: "PUT",
            body: JSON.stringify({ status: status.value, note: note.value, items })
          });
          await refreshData();
          state.selectedOrderId = order.id;
          setMessage("Objednavka bola upravena.");
        } catch (error) {
          setMessage("", error.message);
        }
      }
    }));
    actions.append(el("button", {
      class: "secondary",
      text: "Zrusit upravy",
      onclick: () => {
        state.message = "Upravy boli zrusene.";
        state.error = "";
        render();
      }
    }));
    actions.append(el("button", {
      class: "secondary",
      text: "Zatvorit",
      onclick: () => {
        state.selectedOrderId = null;
        state.message = "";
        state.error = "";
        render();
      }
    }));
  }

  return el("article", { class: "panel grid" }, [
    el("div", { class: "toolbar" }, [
      el("div", {}, [
        el("strong", { text: `Objednavka ${order.number}` }),
        el("div", { class: "muted", text: `${order.customerName} | ${order.customerEmail} | ${order.customerProfile?.operationName || "-"} | ${dateTime(order.createdAt)}` })
      ]),
      el("span", { class: `status ${orderStatusClass(order.status)}`, text: orderStatusLabel(order.status) })
    ]),
    el("div", { class: "table-wrap" }, el("table", {}, [
      tableHead(["Cislo karty", "Nazov", "MJ", "Hmotnost/ks", "Cena", "Mnozstvo", "Hmotnost", "Spolu"]),
      tbody
    ])),
    isAdmin ? el("div", { class: "form-grid" }, [
      el("label", { class: "span-2" }, ["Stav", status]),
      el("label", { class: "span-6" }, ["Poznamka", note])
    ]) : el("p", { class: "muted", text: `Poznamka: ${order.note || "-"}` }),
    el("div", { class: "summary" }, [
      el("strong", { text: `Hmotnost: ${weightText(orderWeight(order))} | Spolu: ${money(orderTotal(order))}` }),
      actions
    ])
  ]);
}

function renderProductsAdmin() {
  const visibleProducts = filteredSortedProducts();
  const container = el("section", { class: "grid" }, [
    pageTitle("Tovarove polozky", "Sprava sortimentu pre objednavky."),
    renderProductForm(),
    renderProductImport(),
    renderProductFilters(visibleProducts.length),
    renderNotice()
  ]);

  const tbody = el("tbody");
  for (const product of visibleProducts) {
    tbody.append(renderProductRow(product));
  }
  if (!visibleProducts.length) {
    tbody.append(el("tr", {}, el("td", { colspan: "7", class: "muted", text: "Filtru nevyhovuje ziadna tovarova polozka." })));
  }
  container.append(el("div", { class: "table-wrap" }, el("table", {}, [
    sortableProductHead(),
    tbody
  ])));
  return container;
}

function productSearchText(product) {
  return [
    product.cardNumber,
    product.name,
    product.unit,
    product.weight,
    product.price,
    product.active ? "aktivna ano" : "neaktivna nie"
  ].join(" ").toLowerCase();
}

function filteredSortedProducts() {
  const filters = state.productFilters;
  const query = filters.query.trim().toLowerCase();
  const minWeight = filters.minWeight === "" ? null : Number(filters.minWeight);
  const maxWeight = filters.maxWeight === "" ? null : Number(filters.maxWeight);
  const minPrice = filters.minPrice === "" ? null : Number(filters.minPrice);
  const maxPrice = filters.maxPrice === "" ? null : Number(filters.maxPrice);

  return [...state.products]
    .filter(product => {
      if (query && !productSearchText(product).includes(query)) return false;
      if (filters.active === "true" && !product.active) return false;
      if (filters.active === "false" && product.active) return false;
      if (minWeight !== null && Number(product.weight) < minWeight) return false;
      if (maxWeight !== null && Number(product.weight) > maxWeight) return false;
      if (minPrice !== null && Number(product.price) < minPrice) return false;
      if (maxPrice !== null && Number(product.price) > maxPrice) return false;
      return true;
    })
    .sort((a, b) => compareProducts(a, b, state.productSort.key) * (state.productSort.direction === "asc" ? 1 : -1));
}

function compareProducts(a, b, key) {
  const values = {
    cardNumber: [a.cardNumber, b.cardNumber],
    name: [a.name, b.name],
    unit: [a.unit, b.unit],
    weight: [Number(a.weight), Number(b.weight)],
    price: [Number(a.price), Number(b.price)],
    active: [a.active ? 1 : 0, b.active ? 1 : 0]
  }[key] || [a.cardNumber, b.cardNumber];
  if (typeof values[0] === "number" && typeof values[1] === "number") return values[0] - values[1];
  return String(values[0] || "").localeCompare(String(values[1] || ""), "sk", { numeric: true, sensitivity: "base" });
}

function renderProductFilters(count) {
  const panel = el("section", { class: "panel grid" });
  panel.append(el("div", { class: "toolbar" }, [
    el("div", {}, [
      el("strong", { text: "Filter tovaru" }),
      el("div", { class: "muted", text: `Zobrazenych ${count} z ${state.products.length}` })
    ]),
    el("button", {
      class: "secondary",
      text: state.productFilterOpen ? "Skryt filter" : "Rozbalit filter",
      onclick: () => {
        state.productFilterOpen = !state.productFilterOpen;
        render();
      }
    })
  ]));

  if (!state.productFilterOpen) return panel;

  const filters = state.productFilters;
  const form = el("form", { class: "form-grid" });
  form.innerHTML = `
    <label class="span-6">Vyhladavanie v tovare
      <input name="query" value="${escapeHtml(filters.query)}" placeholder="cislo karty, nazov, MJ, cena, hmotnost...">
    </label>
    <label class="span-2">Aktivita
      <select name="active">
        <option value="">vsetky</option>
        <option value="true" ${filters.active === "true" ? "selected" : ""}>aktivne</option>
        <option value="false" ${filters.active === "false" ? "selected" : ""}>neaktivne</option>
      </select>
    </label>
    <label class="span-2">Hmotnost od<input name="minWeight" type="number" step="0.01" value="${escapeHtml(filters.minWeight)}"></label>
    <label class="span-2">Hmotnost do<input name="maxWeight" type="number" step="0.01" value="${escapeHtml(filters.maxWeight)}"></label>
    <label class="span-2">Cena od<input name="minPrice" type="number" step="0.01" value="${escapeHtml(filters.minPrice)}"></label>
    <label class="span-2">Cena do<input name="maxPrice" type="number" step="0.01" value="${escapeHtml(filters.maxPrice)}"></label>
    <div class="span-6 actions">
      <button type="submit">Pouzit filter</button>
      <button class="secondary" type="button" data-reset="true">Vycistit filter</button>
    </div>
  `;
  form.addEventListener("submit", event => {
    event.preventDefault();
    state.productFilters = Object.fromEntries(new FormData(form));
    render();
  });
  form.querySelector("[data-reset]").addEventListener("click", () => {
    state.productFilters = defaultProductFilters();
    render();
  });
  panel.append(form);
  return panel;
}

function sortableProductHead() {
  const columns = [
    ["cardNumber", "Cislo karty"],
    ["name", "Nazov"],
    ["unit", "MJ"],
    ["weight", "Hmotnost"],
    ["price", "Cena"],
    ["active", "Aktivna"]
  ];
  return el("thead", {}, el("tr", {}, [
    ...columns.map(([key, label]) => {
      const active = state.productSort.key === key;
      const direction = active ? (state.productSort.direction === "asc" ? " ▲" : " ▼") : "";
      return el("th", {}, el("button", {
        class: `sort-button ${active ? "active" : ""}`,
        text: `${label}${direction}`,
        onclick: () => {
          if (state.productSort.key === key) {
            state.productSort.direction = state.productSort.direction === "asc" ? "desc" : "asc";
          } else {
            state.productSort = { key, direction: ["weight", "price"].includes(key) ? "desc" : "asc" };
          }
          render();
        }
      }));
    }),
    el("th", { text: "Akcie" })
  ]));
}

function renderProductImport() {
  const form = el("form", { class: "panel form-grid" });
  form.innerHTML = `
    <label class="span-3">CSV subor s tovarom
      <input name="csvFile" type="file" accept=".csv,text/csv" required>
    </label>
    <label class="span-2">Duplicity podla cisla karty
      <select name="overwrite">
        <option value="false">preskocit existujuce</option>
        <option value="true">prepisat existujuce</option>
      </select>
    </label>
    <div class="span-6 muted">
      CSV hlavicky: cislo karty, nazov, merna jednotka, hmotnost, cena, aktivna. Podporovane su aj nazvy cardNumber, name, unit, weight, price, active.
    </div>
    <div class="span-6 actions">
      <button type="submit">Importovat CSV</button>
      <button class="secondary" type="button" data-export="true">Exportovat vsetky polozky</button>
    </div>
  `;
  form.querySelector("[data-export]").addEventListener("click", exportProductsCsv);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const file = form.csvFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const products = parseProductsCsv(text);
      if (!products.length) {
        setMessage("", "CSV neobsahuje ziadne platne riadky.");
        return;
      }
      const overwrite = form.overwrite.value === "true";
      const { result, products: updatedProducts } = await api("/api/products/import", {
        method: "POST",
        body: JSON.stringify({ overwrite, products })
      });
      state.products = updatedProducts;
      const duplicateText = result.duplicates.length ? ` Duplicity: ${result.duplicates.join(", ")}.` : "";
      setMessage(`Import hotovy. Nove: ${result.imported}, prepisane: ${result.updated}, preskocene: ${result.skipped}, neplatne: ${result.invalid}.${duplicateText}`);
      form.reset();
    } catch (error) {
      setMessage("", error.message);
    }
  });
  return form;
}

function exportProductsCsv() {
  const csvValue = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csvNumber = value => Number(value || 0).toFixed(2).replace(".", ",");
  const rows = [
    ["cislo karty", "nazov", "merna jednotka", "hmotnost", "cena", "aktivna"],
    ...state.products.map(product => [
      product.cardNumber,
      product.name,
      product.unit,
      csvNumber(product.weight),
      csvNumber(product.price),
      product.active ? "ano" : "nie"
    ])
  ];
  const csv = `\uFEFF${rows.map(row => row.map(csvValue).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = el("a", {
    href: url,
    download: `cornico-tovar-${new Date().toISOString().slice(0, 10)}.csv`
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage(`Exportovanych poloziek: ${state.products.length}.`);
}

function parseProductsCsv(text) {
  const rows = parseCsvRows(text).filter(row => row.some(value => String(value || "").trim()));
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => normalizeCsvHeader(header));
  return rows.slice(1).map(row => {
    const raw = {};
    headers.forEach((header, index) => {
      if (header) raw[header] = row[index] || "";
    });
    return {
      cardNumber: raw.cardNumber,
      name: raw.name,
      unit: raw.unit,
      weight: parseCsvNumber(raw.weight),
      price: parseCsvNumber(raw.price),
      active: parseCsvBoolean(raw.active)
    };
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === ";" || char === ",") && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  rows.push(row);
  return rows;
}

function normalizeCsvHeader(header) {
  const value = String(header || "").trim().toLowerCase();
  return {
    "cislo karty": "cardNumber",
    "číslo karty": "cardNumber",
    "cardnumber": "cardNumber",
    "card_number": "cardNumber",
    "karta": "cardNumber",
    "nazov": "name",
    "názov": "name",
    "name": "name",
    "merna jednotka": "unit",
    "merná jednotka": "unit",
    "mj": "unit",
    "unit": "unit",
    "hmotnost": "weight",
    "hmotnosť": "weight",
    "weight": "weight",
    "cena": "price",
    "price": "price",
    "aktivna": "active",
    "aktívna": "active",
    "active": "active"
  }[value] || "";
}

function parseCsvNumber(value) {
  const normalized = String(value || "").replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseCsvBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["nie", "false", "0", "neaktivna", "neaktívna"].includes(normalized)) return false;
  return true;
}

function renderEmailSettings() {
  const settings = state.emailSettings || {};
  const form = el("form", { class: "panel form-grid" });
  form.innerHTML = `
    <label class="span-6 checkbox-label">
      <input name="smtpEnabled" type="checkbox" ${settings.smtpEnabled ? "checked" : ""}>
      Zapnut odosielanie objednavok e-mailom
    </label>
    <label class="span-6">Sposob odosielania
      <select name="emailProvider">
        <option value="brevo" ${settings.emailProvider === "brevo" ? "selected" : ""}>Brevo API (odporucane)</option>
        <option value="smtp" ${settings.emailProvider === "brevo" ? "" : "selected"}>SMTP server</option>
      </select>
    </label>
    <label class="span-6" data-provider="brevo">Brevo API kluc
      <input name="brevoApiKey" type="password" autocomplete="new-password" placeholder="${settings.hasBrevoApiKey ? "API kluc je ulozeny" : "xkeysib-..."}">
    </label>
    <label class="span-3" data-provider="smtp">SMTP server
      <input name="smtpHost" value="${escapeHtml(settings.smtpHost || "")}" placeholder="smtp.firma.sk">
    </label>
    <label class="span-3" data-provider="smtp">Port
      <input name="smtpPort" type="number" min="1" max="65535" value="${escapeHtml(settings.smtpPort || 587)}">
    </label>
    <label class="span-3" data-provider="smtp">Zabezpecenie
      <select name="smtpSecure">
        <option value="false" ${settings.smtpSecure ? "" : "selected"}>STARTTLS</option>
        <option value="true" ${settings.smtpSecure ? "selected" : ""}>TLS</option>
      </select>
    </label>
    <label class="span-3" data-provider="smtp">Prihlasovacie meno
      <input name="smtpUsername" autocomplete="off" value="${escapeHtml(settings.smtpUsername || "")}">
    </label>
    <label class="span-3" data-provider="smtp">Heslo
      <input name="smtpPassword" type="password" autocomplete="new-password" placeholder="${settings.hasPassword ? "Heslo je ulozene" : ""}">
    </label>
    <label class="span-3">Nazov odosielatela
      <input name="smtpFromName" value="${escapeHtml(settings.smtpFromName || "CORNiCO")}">
    </label>
    <label class="span-3">E-mail odosielatela
      <input name="smtpFromEmail" type="email" value="${escapeHtml(settings.smtpFromEmail || "")}">
    </label>
    <label class="span-3">E-mail pre prijem objednavok
      <input name="ownerEmail" type="email" value="${escapeHtml(settings.ownerEmail || "")}">
    </label>
    <div class="span-6 actions">
      <button type="submit">Ulozit nastavenia</button>
      <button class="secondary" type="button" data-test-smtp="true">Overit sluzbu</button>
    </div>
  `;

  const saveSettings = async () => {
    const values = Object.fromEntries(new FormData(form));
    values.smtpEnabled = form.elements.smtpEnabled.checked;
    values.smtpSecure = values.smtpSecure === "true";
    const { settings: updated } = await api("/api/settings/email", {
      method: "PUT",
      body: JSON.stringify(values)
    });
    state.emailSettings = updated;
  };

  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await saveSettings();
      setMessage("Nastavenia e-mailu boli ulozene.");
    } catch (error) {
      setMessage("", error.message);
    }
  });

  form.querySelector("[data-test-smtp]").addEventListener("click", async () => {
    try {
      await saveSettings();
      await api("/api/settings/email/test", { method: "POST" });
      setMessage("Pripojenie k e-mailovemu serveru je v poriadku.");
    } catch (error) {
      setMessage("", error.message);
    }
  });

  form.elements.smtpSecure.addEventListener("change", () => {
    if (form.elements.smtpHost.value.trim().toLowerCase() !== "smtp.gmail.com") return;
    form.elements.smtpPort.value = form.elements.smtpSecure.value === "true" ? "465" : "587";
  });

  const updateProviderFields = () => {
    const selected = form.elements.emailProvider.value;
    for (const field of form.querySelectorAll("[data-provider]")) {
      field.hidden = field.dataset.provider !== selected;
    }
  };
  form.elements.emailProvider.addEventListener("change", updateProviderFields);
  updateProviderFields();

  return el("section", { class: "grid" }, [
    pageTitle("Nastavenia", "E-mailovy server a dorucovanie objednavok."),
    renderNotice(),
    form
  ]);
}

function renderProfile() {
  return el("section", { class: "grid" }, [
    pageTitle("Moj profil", "Firemne a kontaktne udaje pouzite pri objednavkach."),
    renderCustomerForm(state.user, {
      showLogin: false,
      submitText: "Ulozit profil",
      onSubmit: async payload => {
        const { user } = await api("/api/profile", {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        state.user = user;
        await refreshData();
        setMessage("Profil bol ulozeny.");
      }
    }),
    renderNotice()
  ]);
}

function renderCustomersAdmin() {
  const container = el("section", { class: "grid" }, [
    pageTitle("Zakaznici", "Vytvaranie, uprava a mazanie zakaznickych uctov."),
    renderCustomerForm(null, {
      showLogin: true,
      submitText: "Pridat zakaznika",
      onSubmit: async payload => {
        await api("/api/customers", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await refreshData();
        setMessage("Zakaznik bol pridany.");
      }
    }),
    renderNotice()
  ]);

  if (!state.customers.length) {
    container.append(el("div", { class: "panel muted", text: "Zatial nie su vytvoreni ziadni zakaznici." }));
    return container;
  }

  const tbody = el("tbody");
  for (const customer of state.customers) {
    tbody.append(renderCustomerRow(customer));
  }

  container.append(el("div", { class: "table-wrap" }, el("table", {}, [
    tableHead(["Nazov/meno", "Prevadzka", "Telefon", "E-mail", "Prihlasenie", "Akcie"]),
    tbody
  ])));
  return container;
}

function renderCustomerForm(customer = null, options = {}) {
  const profile = customer?.profile || {};
  const form = el("form", { class: "panel form-grid" });
  const passwordRequired = customer ? "" : "required";
  const passwordHint = customer ? " placeholder=\"Nechajte prazdne bez zmeny\"" : "";
  const loginFields = options.showLogin ? `
    <label class="span-2">Prihlasovacie meno<input name="username" required value="${escapeHtml(customer?.username || "")}"></label>
    <label class="span-2">Heslo<input name="password" type="password" autocomplete="new-password" ${passwordRequired}${passwordHint}></label>
  ` : "";

  form.innerHTML = `
    <label class="span-2">Meno objednavajuceho<input name="name" required value="${escapeHtml(customer?.name || profile.orderingPerson || "")}"></label>
    <label class="span-2">E-mail<input name="email" type="email" required value="${escapeHtml(customer?.email || "")}"></label>
    ${loginFields}
    <label class="span-3">Firemny nazov<input name="companyName" value="${escapeHtml(profile.companyName || "")}"></label>
    <label class="span-3">Nazov prevadzky<input name="operationName" value="${escapeHtml(profile.operationName || "")}"></label>
    <label class="span-2">Telefon<input name="phone" value="${escapeHtml(profile.phone || "")}"></label>
    <label class="span-2">ICO<input name="companyId" value="${escapeHtml(profile.companyId || "")}"></label>
    <label class="span-2">DIC<input name="taxId" value="${escapeHtml(profile.taxId || "")}"></label>
    <label class="span-2">IC DPH<input name="vatId" value="${escapeHtml(profile.vatId || "")}"></label>
    <label class="span-6">Adresa<textarea name="address">${escapeHtml(profile.address || "")}</textarea></label>
    <div class="span-6 actions">
      <button type="submit">${options.submitText || "Ulozit"}</button>
    </div>
  `;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(form));
    const payload = {
      name: formData.name,
      email: formData.email,
      username: formData.username,
      password: formData.password,
      profile: {
        companyName: formData.companyName,
        companyId: formData.companyId,
        taxId: formData.taxId,
        vatId: formData.vatId,
        phone: formData.phone,
        orderingPerson: formData.name,
        operationName: formData.operationName,
        address: formData.address
      }
    };
    try {
      await options.onSubmit(payload);
    } catch (error) {
      setMessage("", error.message);
    }
  });

  return form;
}

function renderCustomerRow(customer) {
  const row = el("tr");
  row.append(
    el("td", {}, [
      el("strong", { text: customer.profile?.companyName || customer.name }),
      el("div", { class: "muted", text: customer.name })
    ]),
    el("td", { text: customer.profile?.operationName || "-" }),
    el("td", { text: customer.profile?.phone || "-" }),
    el("td", { text: customer.email }),
    el("td", { text: customer.username }),
    el("td", {}, el("div", { class: "actions" }, [
      el("button", {
        class: "secondary",
        text: "Upravit",
        onclick: () => {
          const editRow = el("tr");
          const cell = el("td", { colspan: "6" }, renderCustomerForm(customer, {
            showLogin: true,
            submitText: "Ulozit zakaznika",
            onSubmit: async payload => {
              await api(`/api/customers/${customer.id}`, {
                method: "PUT",
                body: JSON.stringify(payload)
              });
              await refreshData();
              setMessage("Zakaznik bol upraveny.");
            }
          }));
          editRow.append(cell);
          row.replaceWith(editRow);
        }
      }),
      el("button", {
        class: "danger",
        text: "Vymazat",
        onclick: async () => {
          const ok = confirm(`Naozaj vymazat zakaznika "${customer.name}"?`);
          if (!ok) return;
          try {
            await api(`/api/customers/${customer.id}`, { method: "DELETE" });
            await refreshData();
            setMessage("Zakaznik bol vymazany.");
          } catch (error) {
            setMessage("", error.message);
          }
        }
      })
    ]))
  );
  return row;
}

function renderProductForm(product = null) {
  const form = el("form", { class: "panel form-grid" });
  form.innerHTML = `
    <label class="span-2">Cislo karty<input name="cardNumber" required value="${product?.cardNumber || ""}"></label>
    <label class="span-3">Nazov<input name="name" required value="${product?.name || ""}"></label>
    <label>MJ<input name="unit" required value="${product?.unit || ""}"></label>
    <label class="span-2">Hmotnost<input name="weight" type="number" step="0.01" required value="${product?.weight || 0}"></label>
    <label class="span-2">Cena<input name="price" type="number" step="0.01" required value="${product?.price || 0}"></label>
    <label class="span-2">Aktivna
      <select name="active">
        <option value="true">ano</option>
        <option value="false">nie</option>
      </select>
    </label>
    <div class="span-6 actions">
      <button type="submit">${product ? "Ulozit polozku" : "Pridat polozku"}</button>
    </div>
  `;
  if (product) form.active.value = String(product.active);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.active = data.active === "true";
    try {
      await api(product ? `/api/products/${product.id}` : "/api/products", {
        method: product ? "PUT" : "POST",
        body: JSON.stringify(data)
      });
      await refreshData();
      setMessage(product ? "Polozka bola upravena." : "Polozka bola pridana.");
    } catch (error) {
      setMessage("", error.message);
    }
  });
  return form;
}

function renderProductRow(product) {
  const row = el("tr");
  row.append(
    el("td", { text: product.cardNumber }),
    el("td", { text: product.name }),
    el("td", { text: product.unit }),
    el("td", { text: product.weight }),
    el("td", { text: money(product.price) }),
    el("td", { text: product.active ? "ano" : "nie" }),
    el("td", {}, el("div", { class: "actions" }, [
      el("button", {
        class: "secondary",
        text: "Upravit",
        onclick: () => {
          const editRow = el("tr");
          const cell = el("td", { colspan: "7" }, renderProductForm(product));
          editRow.append(cell);
          row.replaceWith(editRow);
        }
      }),
      el("button", {
        class: "danger",
        text: "Vymazat",
        onclick: async () => {
          const ok = confirm(`Naozaj vymazat polozku "${product.name}"?`);
          if (!ok) return;
          try {
            await api(`/api/products/${product.id}`, { method: "DELETE" });
            await refreshData();
            setMessage("Polozka bola vymazana.");
          } catch (error) {
            setMessage("", error.message);
          }
        }
      })
    ]))
  );
  return row;
}

function printOrder(order) {
  state.printOrder = order;
  render();
  setTimeout(() => {
    window.print();
    state.printOrder = null;
    render();
  }, 100);
}

function renderPrintOrder(order) {
  return el("section", { class: "order-print" }, [
    el("img", { class: "print-logo", src: "/assets/cornico-logo.png", alt: "CORNiCO", onerror: event => event.currentTarget.hidden = true }),
    el("h1", { text: `Objednavka ${order.number}` }),
    el("p", { text: `Zakaznik: ${order.customerName} | ${order.customerEmail}` }),
    el("p", { text: `Datum: ${dateTime(order.createdAt)}` }),
    el("p", { text: `Poznamka: ${order.note || "-"}` }),
    el("table", {}, [
      tableHead(["Cislo karty", "Nazov", "MJ", "Hmotnost/ks", "Cena", "Mnozstvo", "Hmotnost", "Spolu"]),
      el("tbody", {}, order.items.map(item => el("tr", {}, [
        el("td", { text: item.cardNumber }),
        el("td", { text: item.name }),
        el("td", { text: item.unit }),
        el("td", { text: weightText(item.weight) }),
        el("td", { text: money(item.price) }),
        el("td", { text: item.quantity }),
        el("td", { text: weightText(item.quantity * item.weight) }),
        el("td", { text: money(item.quantity * item.price) })
      ])))
    ]),
    el("h2", { text: `Hmotnost: ${weightText(orderWeight(order))} | Spolu: ${money(orderTotal(order))}` })
  ]);
}

function pageTitle(title, subtitle) {
  return el("div", { class: "page-title" }, [
    el("div", {}, [el("h1", { text: title }), el("p", { class: "muted", text: subtitle })])
  ]);
}

function tableHead(labels) {
  return el("thead", {}, el("tr", {}, labels.map(label => el("th", { text: label }))));
}

function renderNotice() {
  return el("div", {}, [
    state.message ? el("p", { class: "message", text: state.message }) : "",
    state.error ? el("p", { class: "message error", text: state.error }) : ""
  ]);
}

loadSession().catch(error => {
  app.innerHTML = `<main class="login-screen"><div class="login-panel"><h1>Chyba</h1><p>${error.message}</p></div></main>`;
});
