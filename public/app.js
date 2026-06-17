const app = document.querySelector("#app");

let state = {
  user: null,
  products: [],
  orders: [],
  customers: [],
  view: "order",
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
    if (user.role === "admin" && state.view === "order") state.view = "dashboard";
    await refreshData();
  }
  render();
}

async function refreshData() {
  const requests = [
    api("/api/products"),
    api("/api/orders")
  ];
  if (state.user?.role === "admin") requests.push(api("/api/customers"));
  const [productsData, ordersData, customersData] = await Promise.all(requests);
  state.products = productsData.products;
  state.orders = ordersData.orders;
  state.customers = customersData?.customers || [];
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
    <div>
      <h1>Objednavaci system</h1>
      <p class="muted">Prihlasenie zakaznika alebo administratora.</p>
    </div>
    <label>Prihlasovacie meno<input name="username" autocomplete="username" required value="zakaznik"></label>
    <label>Heslo<input name="password" type="password" autocomplete="current-password" required value="zakaznik123"></label>
    <button type="submit">Prihlasit sa</button>
    <p class="muted">Demo: zakaznik / zakaznik123 alebo admin / admin123</p>
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
      state.view = user.role === "admin" ? "dashboard" : "order";
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
    ? [["dashboard", "Prehlad"], ["orders", "Historia objednavok"], ["products", "Tovarove polozky"], ["customers", "Zakaznici"]]
    : [["order", "Nova objednavka"], ["my-orders", "Moje objednavky"], ["profile", "Moj profil"]];

  shell.append(
    el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [el("span", { class: "brand-mark", text: "O" }), "Online objednavky"]),
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
      onclick: () => {
        state.view = view;
        if (view !== "orders") state.selectedOrderId = null;
        state.message = "";
        state.error = "";
        render();
      }
    }));
  }

  const main = el("main", { class: "main" });
  if (state.view === "dashboard") main.append(renderAdminDashboard());
  if (state.view === "order") main.append(renderCustomerOrder());
  if (state.view === "my-orders") main.append(renderOrders(false));
  if (state.view === "orders") main.append(renderOrders(true));
  if (state.view === "products") main.append(renderProductsAdmin());
  if (state.view === "customers") main.append(renderCustomersAdmin());
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
    view: "order",
    selectedOrderId: null,
    orderFilterOpen: false,
    orderFilters: defaultOrderFilters(),
    orderSort: { key: "date", direction: "desc" },
    message: "",
    error: "",
    printOrder: null
  };
  render();
}

function renderCustomerOrder() {
  const quantities = new Map();
  const note = el("textarea", { placeholder: "Volitelna poznamka k objednavke" });
  const tbody = el("tbody");

  for (const product of state.products) {
    const quantity = el("input", { class: "number-input", type: "number", min: "0", step: "1", value: "0" });
    quantities.set(product.id, quantity);
    tbody.append(el("tr", {}, [
      el("td", { text: product.cardNumber }),
      el("td", { text: product.name }),
      el("td", { text: product.unit }),
      el("td", { text: weightText(product.weight) }),
      el("td", { text: money(product.price) }),
      el("td", {}, quantity)
    ]));
  }

  const form = el("form", { class: "grid" }, [
    pageTitle("Nova objednavka", "Vyplnte mnozstva pri tovare, ktory chcete objednat."),
    el("div", { class: "table-wrap" }, el("table", {}, [
      tableHead(["Cislo karty", "Nazov", "MJ", "Hmotnost", "Cena", "Mnozstvo"]),
      tbody
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
    const items = [...quantities.entries()].map(([productId, input]) => ({
      productId,
      quantity: Math.trunc(Number(input.value || 0))
    }));
    try {
      await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ note: note.value, items })
      });
      await refreshData();
      state.view = "my-orders";
      setMessage("Objednavka bola odoslana a zapis e-mailu bol vytvoreny.");
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

  for (const order of state.orders) {
    container.append(renderOrderPanel(order, isAdmin));
  }
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
  const container = el("section", { class: "grid" }, [
    pageTitle("Tovarove polozky", "Sprava sortimentu pre objednavky."),
    renderProductForm(),
    renderNotice()
  ]);

  const tbody = el("tbody");
  for (const product of state.products) {
    tbody.append(renderProductRow(product));
  }
  container.append(el("div", { class: "table-wrap" }, el("table", {}, [
    tableHead(["Cislo karty", "Nazov", "MJ", "Hmotnost", "Cena", "Aktivna", "Akcie"]),
    tbody
  ])));
  return container;
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
    <label class="span-2">Heslo<input name="password" ${passwordRequired}${passwordHint}></label>
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
