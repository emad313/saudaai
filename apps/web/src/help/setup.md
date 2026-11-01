# Setting up SaudaAI for your shop

This guide walks a shop owner through connecting a store and the places customers chat. Each part works on its own; do them in any order.

## 1. Connect your store

Settings > Your store. SaudaAI reads products, prices, stock, photos and orders from the store and creates orders there when you approve them.

### Shopify

1. In the Shopify Dev Dashboard (dev.shopify.com) create an app for your store.
2. Create a version with these scopes:
   `read_products,write_products,read_inventory,write_inventory,read_locations,read_orders,write_orders,read_draft_orders,write_draft_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_content,write_content`
3. Turn on protected customer data. Orders cannot be created without it.
   - On the app's Home, open the Distribution card and choose Custom distribution for your store.
   - In the Partner Dashboard open the app, then API access requests, then Protected customer data access, then Request access.
   - Select Protected customer data and the fields Name, Email, Phone and Address, give a short reason, and save. On a development store this is approved at once.
4. Install the app on your store and copy the Admin API access token and the app's client secret.
5. In SaudaAI Settings choose Shopify, enter `your-shop.myshopify.com`, the token and the secret, then Connect.
6. Shopify only accepts orders it can ship. In Shopify Settings > Shipping and delivery, add Bangladesh (or wherever your customers are) to a shipping zone with any rate. SaudaAI sets the delivery charge on each order itself.

If Settings shows updates the store refused, the reason is next to each one. Order updates need step 3; stock updates need `read_inventory`.

### WooCommerce

1. In WordPress open WooCommerce > Settings > Advanced > REST API and add a key with Read/Write permission.
2. For website banners and photo uploads, also open Users > your profile > Application Passwords and add one named SaudaAI.
3. In SaudaAI Settings choose WooCommerce, enter the site address, the key and secret, and (optional) the WordPress username and application password.

### Your own site

Implement the SaudaAI Store API (five routes, see the README) and give SaudaAI the site address and a token.

## 2. Put the chat on your website

Settings shows the widget snippet with your shop key. It is one line:

```html
<script src="https://YOUR-SAUDAAI-ADDRESS/widget.js" data-shop="YOUR-SHOP-KEY" defer></script>
```

### On Shopify

1. Shopify admin > Online Store > Themes > the three dots next to your theme > Edit code.
2. Open `layout/theme.liquid`.
3. Paste this just before `</body>` (it also tells the assistant which product the customer is looking at):

```liquid
<script src="https://YOUR-SAUDAAI-ADDRESS/widget.js" data-shop="YOUR-SHOP-KEY" {% if product %}data-product="gid://shopify/Product/{{ product.id }}"{% endif %} defer></script>
```

4. Save and open your store. A chat bubble appears bottom right.

### On WooCommerce

Paste the snippet with any "insert headers and footers" plugin, in the footer.

## 3. Messenger and Instagram

1. Create a Meta app with Messenger (and Instagram) added, and connect your Facebook Page.
2. In Graph API Explorer pick the app, choose User Token, and tick `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_posts` (Page posts), `instagram_basic`, `instagram_manage_messages`, `instagram_content_publish` (Instagram).
3. Run `pnpm page:token <that token>` and put the printed `MESSENGER_PAGE_TOKEN` in `.env`. This token does not expire.
4. For Instagram, link an Instagram professional account to the Page and set `INSTAGRAM_ACCOUNT_ID`.
5. `pnpm webhooks:set` prints the webhook URL and verify token to enter in the Meta app (fields `messages`, `messaging_postbacks`).

While the Meta app is in development mode only people added as app testers can message the bot.

## 4. WhatsApp

1. In the Meta app add WhatsApp and note the test phone number id; create a permanent token (System User in Business Settings).
2. Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`, and add the numbers you test with as verified recipients.
3. Submit a message template named `payment_reminder` (language Bangla, three variables: name, order number, amount due). Reminders after 24 hours of silence use it.
4. Point the WhatsApp webhook at the same URL as Messenger (field `messages`).

## 5. Telegram for the owner

Message the shop's bot, send `/login`, and enter the code in the dashboard. Approvals, voice orders and the daily summary arrive there.

## What the assistant does on its own and what it asks you

- On its own: answers about products, prices, sizes, stock, delivery charge and order status; sends store photos; takes the order details.
- Asks you first: confirming an order, invoices, payment entries and reminders, discounts, cancellations, new products, posts to the Page, Instagram or website. You can let some of these run without asking in Settings, under "What the assistant may do without asking".
