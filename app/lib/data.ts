import postgres from "postgres";
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from "./definitions";
import { formatCurrency } from "./utils";
import {
  customers as placeholderCustomers,
  invoices as placeholderInvoices,
  revenue as placeholderRevenue,
} from "./placeholder-data";

const sql = process.env.POSTGRES_URL
  ? postgres(process.env.POSTGRES_URL, { ssl: "require" })
  : null;

function getPlaceholderCustomer(customerId: string) {
  return (
    placeholderCustomers.find((customer) => customer.id === customerId) ??
    placeholderCustomers[0]
  );
}

function getPlaceholderInvoices() {
  return [...placeholderInvoices].sort(
    (left, right) =>
      new Date(right.date).getTime() - new Date(left.date).getTime(),
  );
}

function buildFallbackRevenue(): Revenue[] {
  return placeholderRevenue;
}

function buildFallbackLatestInvoices() {
  return getPlaceholderInvoices()
    .slice(0, 5)
    .map((invoice, index) => {
      const customer = getPlaceholderCustomer(invoice.customer_id);

      return {
        id: `${invoice.customer_id}-${invoice.date}-${index}`,
        name: customer.name,
        image_url: customer.image_url,
        email: customer.email,
        amount: formatCurrency(invoice.amount),
      };
    });
}

function buildFallbackCardData() {
  const invoices = getPlaceholderInvoices();

  const numberOfInvoices = invoices.length;
  const numberOfCustomers = placeholderCustomers.length;
  const totalPaidInvoices = formatCurrency(
    invoices
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + invoice.amount, 0),
  );
  const totalPendingInvoices = formatCurrency(
    invoices
      .filter((invoice) => invoice.status === "pending")
      .reduce((sum, invoice) => sum + invoice.amount, 0),
  );

  return {
    numberOfCustomers,
    numberOfInvoices,
    totalPaidInvoices,
    totalPendingInvoices,
  };
}

function buildFallbackFilteredInvoices(query: string, currentPage: number) {
  const itemsPerPage = 6;
  const offset = (currentPage - 1) * itemsPerPage;
  const normalizedQuery = query.toLowerCase();

  return getPlaceholderInvoices()
    .map((invoice, index) => {
      const customer = getPlaceholderCustomer(invoice.customer_id);

      return {
        id: `${invoice.customer_id}-${invoice.date}-${index}`,
        customer_id: invoice.customer_id,
        name: customer.name,
        email: customer.email,
        image_url: customer.image_url,
        date: invoice.date,
        amount: invoice.amount,
        status: invoice.status,
      };
    })
    .filter((invoice) => {
      return (
        invoice.name.toLowerCase().includes(normalizedQuery) ||
        invoice.email.toLowerCase().includes(normalizedQuery) ||
        String(invoice.amount).toLowerCase().includes(normalizedQuery) ||
        invoice.date.toLowerCase().includes(normalizedQuery) ||
        invoice.status.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(offset, offset + itemsPerPage);
}

function buildFallbackFilteredCustomers(query: string) {
  const normalizedQuery = query.toLowerCase();

  return placeholderCustomers
    .map((customer) => {
      const customerInvoices = placeholderInvoices.filter(
        (invoice) => invoice.customer_id === customer.id,
      );

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        image_url: customer.image_url,
        total_invoices: customerInvoices.length,
        total_pending: customerInvoices
          .filter((invoice) => invoice.status === "pending")
          .reduce((sum, invoice) => sum + invoice.amount, 0),
        total_paid: customerInvoices
          .filter((invoice) => invoice.status === "paid")
          .reduce((sum, invoice) => sum + invoice.amount, 0),
      };
    })
    .filter((customer) => {
      return (
        customer.name.toLowerCase().includes(normalizedQuery) ||
        customer.email.toLowerCase().includes(normalizedQuery)
      );
    })
    .map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));
}

export async function fetchRevenue() {
  try {
    // Artificially delay a response for demo purposes.
    // Don't do this in production :)

    // console.log('Fetching revenue data...');
    // await new Promise((resolve) => setTimeout(resolve, 3000));

    if (!sql) {
      return buildFallbackRevenue();
    }

    const data = await sql<Revenue[]>`SELECT * FROM revenue`;

    // console.log('Data fetch completed after 3 seconds.');

    return data;
  } catch (error) {
    console.error("Database Error:", error);
    return buildFallbackRevenue();
  }
}

export async function fetchLatestInvoices() {
  try {
    if (!sql) {
      return buildFallbackLatestInvoices();
    }

    const data = await sql<LatestInvoiceRaw[]>`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5`;

    const latestInvoices = data.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error("Database Error:", error);
    return buildFallbackLatestInvoices();
  }
}

export async function fetchCardData() {
  try {
    if (!sql) {
      return buildFallbackCardData();
    }

    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const invoiceCountPromise = sql`SELECT COUNT(*) FROM invoices`;
    const customerCountPromise = sql`SELECT COUNT(*) FROM customers`;
    const invoiceStatusPromise = sql`SELECT
         SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
         SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
         FROM invoices`;

    const data = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(data[0][0].count ?? "0");
    const numberOfCustomers = Number(data[1][0].count ?? "0");
    const totalPaidInvoices = formatCurrency(data[2][0].paid ?? "0");
    const totalPendingInvoices = formatCurrency(data[2][0].pending ?? "0");

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error("Database Error:", error);
    return buildFallbackCardData();
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    if (!sql) {
      return buildFallbackFilteredInvoices(query, currentPage);
    }

    const invoices = await sql<InvoicesTable[]>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;

    return invoices;
  } catch (error) {
    console.error("Database Error:", error);
    return buildFallbackFilteredInvoices(query, currentPage);
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    if (!sql) {
      return Math.ceil(
        buildFallbackFilteredInvoices(query, 1).length / ITEMS_PER_PAGE,
      );
    }

    const data = await sql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(data[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error("Database Error:", error);
    return Math.ceil(
      buildFallbackFilteredInvoices(query, 1).length / ITEMS_PER_PAGE,
    );
  }
}

export async function fetchInvoiceById(id: string) {
  try {
    if (!sql) {
      const fallbackInvoice = placeholderInvoices[0];
      return {
        id,
        customer_id: fallbackInvoice.customer_id,
        amount: fallbackInvoice.amount / 100,
        status: fallbackInvoice.status,
      };
    }

    const data = await sql<InvoiceForm[]>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = data.map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error("Database Error:", error);
    const fallbackInvoice = placeholderInvoices[0];
    return {
      id,
      customer_id: fallbackInvoice.customer_id,
      amount: fallbackInvoice.amount / 100,
      status: fallbackInvoice.status,
    };
  }
}

export async function fetchCustomers() {
  try {
    if (!sql) {
      return placeholderCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
      }));
    }

    const customers = await sql<CustomerField[]>`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;

    return customers;
  } catch (err) {
    console.error("Database Error:", err);
    return placeholderCustomers.map((customer) => ({
      id: customer.id,
      name: customer.name,
    }));
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    if (!sql) {
      return buildFallbackFilteredCustomers(query);
    }

    const data = await sql<CustomersTableType[]>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error("Database Error:", err);
    return buildFallbackFilteredCustomers(query);
  }
}
