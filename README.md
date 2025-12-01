# P.U.L.S.E. (Page Usage & Live Statistics Engine)

A high-performance, self-hosted analytics microservice designed for low-latency view counting.

## ⚠️ Public Instance & Fair Usage Policy

This project is Open Source and free to use. I host a public instance on a **small, personal VPS** as a convenience.

  * **For Small Projects:** Feel free to use the hosted widget\!
  * **For High Traffic:** If you expect thousands of concurrent hits or a viral launch, **please self-host this**. The public server's stability cannot be guaranteed under heavy load.

The public instance is provided "as-is" until the server costs exceed my budget.

## ⚡ Key Features

  * **Redis HyperLogLog:** Counts millions of unique visitors with minimal memory footprint (\~12KB).
  * **Write-Behind Caching:** Flushes data to disk (SQLite) only once every 10 seconds, preventing disk IO bottlenecks during traffic spikes.
  * **Bot Protection:** Rate limiting on the creation API prevents database spam.
  * **Badge Designer:** UI allows full customization of badge style, color, icon, and data mode (Views, Unique, Both).

## 🛠 Tech Stack

  * **Runtime:** Node.js (Express)
  * **Buffer/Cache:** Redis (IOredis)
  * **Persistence:** SQLite (WAL Mode)

## 🚀 Deployment

### Prerequisites

  * Docker & Docker Compose

### Configuration (Secure)

1.  Clone the repository:

    ```bash
    git clone https://github.com/tildemark/pulse.git
    cd pulse
    ```

2.  Create a `.env` file in the same folder. **Do not commit this file to GitHub.**

    ```bash
    nano .env
    ```

3.  Paste and customize the following content into your `.env` file:

    ```env
    DOMAIN=https://counter.sanchez.ph
    GITHUB_URL=https://github.com/tildemark/pulse
    ADMIN_USER=admin
    ADMIN_PASS=SuperSecurePassword123!
    ```

### Run

Docker will automatically read the variables from your `.env` file.

```bash
docker-compose up -d --build
```

### Portainer Users

When creating your Stack, paste the content of `docker-compose.yml` and enter the `DOMAIN`, `ADMIN_USER`, and `ADMIN_PASS` values directly into the **Environment variables** section of the Portainer UI.

## 📖 Usage

### Badge Generation

Customize the badge URL with query parameters:

```
https://counter.sanchez.ph/badge/{SITE_ID}?style=flat&color=blue&mode=both
```

| Parameter | Options | Default |
| :--- | :--- | :--- |
| `style` | `flat`, `flat-square`, `plastic` | `flat` |
| `color` | Hex Code (e.g., `ff0000`, `4c1`) | `4c1` (Green) |
| `mode` | `views`, `unique`, `both` | `both` |
| `icon` | `eye`, `user`, `fire`, `star`, `heart` | `none` |

### Javascript Client

For invisible tracking or custom text elements on your site:

```html
<script src="https://counter.sanchez.ph/client.js" data-site-id="YOUR_SITE_ID" defer></script>

<!-- Example display element -->
<span id="pulse-count">0</span> views
```

-----

**License:** MIT
