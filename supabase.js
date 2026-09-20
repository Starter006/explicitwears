const SUPABASE_URL = 'https://iggihiootmfiywyrtidn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kCjLO_sGd5a50nKh2PgQLg_S2A9b0sg';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function firstValue(record, keys, fallback = '') {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key];
  }
  return fallback;
}

function normalizeProduct(product, images, variants) {
  const productImages = images
    .filter((image) => String(image.product_id) === String(product.id))
    .sort((a, b) => Number(firstValue(a, ['sort_order', 'position'], 0)) - Number(firstValue(b, ['sort_order', 'position'], 0)));
  const productVariants = variants.filter((variant) => String(variant.product_id) === String(product.id));
  const image = firstValue(productImages[0] || {}, ['image_url', 'public_url', 'url', 'src', 'storage_path', 'path'], 'background.jpeg');
  const normalizedVariants = productVariants.map((variant) => ({
    id: String(firstValue(variant, ['id', 'variant_id'], `${product.id}-${firstValue(variant, ['size', 'name', 'value'], 'OS')}`)),
    value: String(firstValue(variant, ['size', 'name', 'value'], 'OS')),
    color: String(firstValue(variant, ['color', 'colour'], firstValue(product, ['color', 'colour'], ''))),
    price: Number(firstValue(variant, ['price', 'amount'], firstValue(product, ['price', 'amount'], 0))),
    stock: Number(firstValue(variant, ['stock', 'stock_quantity', 'inventory', 'quantity'], 0))
  }));
  const availableVariants = normalizedVariants.filter((variant) => variant.stock > 0);
  const productPrice = availableVariants[0]?.price || normalizedVariants[0]?.price || Number(firstValue(product, ['price', 'amount'], 0));
  const productStatus = String(firstValue(product, ['status', 'state'], 'active')).toLowerCase() === 'inactive' ? 'inactive' : 'active';

  return {
    id: String(product.id),
    name: firstValue(product, ['name', 'title'], 'Untitled product'),
    category: firstValue(product, ['category', 'type'], 'Collection'),
    price: productPrice,
    color: availableVariants[0]?.color || normalizedVariants[0]?.color || '',
    description: firstValue(product, ['description', 'details'], ''),
    image,
    images: productImages.map((item) => firstValue(item, ['image_url', 'public_url', 'url', 'src', 'storage_path', 'path'], image)),
    variants: normalizedVariants,
    sizes: [...new Set(normalizedVariants.map((variant) => variant.value))],
    featured: Boolean(firstValue(product, ['featured', 'is_featured'], false)),
    status: productStatus,
    newest: new Date(product.created_at || 0).getTime()
  };
}

async function getProducts() {
  const { data: products, error: productsError } = await supabaseClient
    .from('products')
    .select('*');
  if (productsError) throw productsError;
  if (!products || products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const [{ data: images, error: imagesError }, { data: variants, error: variantsError }] = await Promise.all([
    supabaseClient.from('product_images').select('*').in('product_id', productIds),
    supabaseClient.from('product_variants').select('*').in('product_id', productIds)
  ]);
  if (imagesError) throw imagesError;
  if (variantsError) throw variantsError;

  return products
    .filter((product) => String(firstValue(product, ['status', 'state'], 'active')).toLowerCase() !== 'inactive')
    .map((product) => normalizeProduct(product, images || [], variants || []));
}

async function getProduct(productId) {
  const { data: product, error: productError } = await supabaseClient
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return null;

  const [{ data: images, error: imagesError }, { data: variants, error: variantsError }] = await Promise.all([
    supabaseClient.from('product_images').select('*').eq('product_id', product.id).order('sort_order', { ascending: true }),
    supabaseClient.from('product_variants').select('*').eq('product_id', product.id)
  ]);
  if (imagesError) throw imagesError;
  if (variantsError) throw variantsError;
  return normalizeProduct(product, images || [], variants || []);
}

async function createOrder(order) {
  const { data, error } = await supabaseClient
    .from('orders')
    .insert(order)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function uploadProductImages(product, files) {
  if (!product?.id) throw new Error('A product id is required.');
  if (!files?.length) throw new Error('Select at least one image.');

  const uploadedRows = [];
  for (const [index, file] of Array.from(files).entries()) {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${product.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseClient.storage
      .from('Product-images')
      .upload(filePath, file, { contentType: file.type || 'image/jpeg', upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabaseClient.storage
      .from('Product-images')
      .getPublicUrl(filePath);
    uploadedRows.push({
      product_id: product.id,
      image_url: publicUrl.publicUrl,
      sort_order: index
    });
  }

  const { data, error } = await supabaseClient
    .from('product_images')
    .insert(uploadedRows)
    .select();
  if (error) throw error;
  return data;
}

async function signUp(email, password, fullName) {
  return supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
}

async function signIn(email, password) {
  return supabaseClient.auth.signInWithPassword({ email, password });
}

async function signOut() {
  return supabaseClient.auth.signOut();
}

async function getSession() {
  return supabaseClient.auth.getSession();
}

async function getOrCreateCustomer(user) {
  // Every Supabase Auth user gets a customers row from the database trigger
  // (on_auth_user_created, see supabase-customer-sync.sql). This function only
  // needs to find that row — matching on the auth user id first, then email for
  // legacy rows created before user_id linking existed. The insert below is
  // just a fallback for the unlikely case the trigger has not run yet.
  const columns = 'id,email,full_name,user_id';

  let { data: existing, error: findError } = await supabaseClient
    .from('customers')
    .select(columns)
    .eq('user_id', user.id)
    .maybeSingle();
  if (findError && (findError.code === '42703' || findError.code === 'PGRST204')) {
    // user_id is not in the schema cache yet (SQL migration not applied).
    const legacy = await supabaseClient
      .from('customers')
      .select('id,email,full_name')
      .eq('email', user.email)
      .maybeSingle();
    existing = legacy.data;
    findError = legacy.error;
  }
  if (findError) throw findError;
  if (!existing) {
    const byEmail = await supabaseClient
      .from('customers')
      .select(columns)
      .eq('email', user.email)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    existing = byEmail.data;
  }
  if (existing) return existing;

  const { data, error } = await supabaseClient
    .from('customers')
    // customers.id foreign keys auth.users(id) (customers_id_fkey), so id MUST
    // be the auth user's id — same value as user_id.
    .insert({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '', user_id: user.id })
    .select(columns)
    .single();
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      // Same as above — the migration has not been applied yet.
      const legacyInsert = await supabaseClient
        .from('customers')
        .insert({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '' })
        .select('id,email,full_name')
        .single();
      if (legacyInsert.error) throw legacyInsert.error;
      return legacyInsert.data;
    }
    if (error.code === '23505') {
      // Lost a race with the trigger's own insert — re-read the created row.
      // id = user_id = the auth id; legacy rows may only be linked by user_id.
      let rerun = await supabaseClient
        .from('customers')
        .select(columns)
        .eq('id', user.id)
        .maybeSingle();
      if (rerun.error) throw rerun.error;
      if (!rerun.data) {
        rerun = await supabaseClient
          .from('customers')
          .select(columns)
          .eq('user_id', user.id)
          .maybeSingle();
        if (rerun.error) throw rerun.error;
      }
      if (rerun.data) return rerun.data;
    }
    throw error;
  }
  return data;
}

async function getOrCreateUserCart(user) {
  const { data: existing, error: findError } = await supabaseClient
    .from('carts')
    .select('id,user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabaseClient
    .from('carts')
    .insert({ user_id: user.id })
    .select('id,user_id')
    .single();
  if (error) throw error;
  return data;
}

async function getUserCart(user) {
  await getOrCreateCustomer(user);
  const cart = await getOrCreateUserCart(user);
  const { data, error } = await supabaseClient
    .from('cart_items')
    .select('id,cart_id,variant_id,quantity')
    .eq('cart_id', cart.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveUserCart(user, items) {
  await getOrCreateCustomer(user);
  const cart = await getOrCreateUserCart(user);
  const { error: deleteError } = await supabaseClient
    .from('cart_items')
    .delete()
    .eq('cart_id', cart.id);
  if (deleteError) throw deleteError;
  if (!items.length) return cart;

  const { error: insertError } = await supabaseClient
    .from('cart_items')
    .insert(items.map((item) => ({
      cart_id: cart.id,
      variant_id: item.variantId,
      quantity: item.quantity
    })));
  if (insertError) throw insertError;
  return cart;
}

async function listAddresses(user) {
  const { data, error } = await supabaseClient
    .from('addresses')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createAddress(user, address) {
  const { data, error } = await supabaseClient
    .from('addresses')
    .insert({
      user_id: user.id,
      full_name: address.full_name,
      phone: address.phone,
      address_line: address.address_line,
      city: address.city,
      region: address.region,
      is_default: Boolean(address.is_default)
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function placeOrder(address) {
  // The SQL function (see supabase-orders.sql) does everything atomically:
  // validates the address belongs to the caller, snapshots cart lines into
  // order_items, decrements variant stock, creates the order, and clears the
  // cart — all inside one transaction.
  const { data, error } = await supabaseClient
    .rpc('place_order', { p_address_id: address.id });
  if (error) throw error;
  if (!data) throw new Error('Your cart is empty or the selected address is unavailable.');
  return data;
}

async function getUserOrders(user) {
  const { data, error } = await supabaseClient
    .from('orders')
    .select('id,order_number,total,status,payment_status,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getOrder(user, orderId) {
  const { data: order, error } = await supabaseClient
    .from('orders')
    .select('id,order_number,total,status,payment_status,created_at,shipping_name,shipping_address,shipping_city,shipping_phone')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const { data: items, error: itemsError } = await supabaseClient
    .from('order_items')
    .select('id,product_name,size,color,price,quantity')
    .eq('order_id', order.id);
  if (itemsError) throw itemsError;
  return { ...order, items: items || [] };
}

async function updateOrderPaymentStatus(orderId, paymentStatus) {
  const { data, error } = await supabaseClient
    .from('orders')
    .update({ payment_status: paymentStatus })
    .eq('id', orderId)
    .select('id,payment_status')
    .single();
  if (error) throw error;
  return data;
}

async function verifySignupEmail(email, token) {
  // Supabase email OTP: confirms the signup and, on success, returns a session
  // just like a normal login — so the shopper lands in a fully signed-in state.
  return supabaseClient.auth.verifyOtp({ email, token, type: 'signup' });
}

async function resendSignupCode(email) {
  // Re-sends the signup confirmation email. Requires the original signup to
  // exist and not already be verified.
  return supabaseClient.auth.resend({ type: 'signup', email });
}

async function isAdmin() {
  const { data, error } = await supabaseClient.rpc('is_admin');
  return { data: data === true, error };
}

async function adminListOrders() {
  return supabaseClient.rpc('admin_list_orders');
}

async function adminOrderItems(orderId) {
  return supabaseClient.rpc('admin_order_items', { p_order_id: orderId });
}

async function adminUpdateOrderStatus(orderId, status) {
  return supabaseClient.rpc('admin_update_order_status', { p_order_id: orderId, p_status: status });
}

async function adminLowStock(threshold = 5) {
  return supabaseClient.rpc('admin_low_stock', { p_threshold: threshold });
}

async function adminListProducts() {
  const [{ data: products, error: productsError }, { data: images, error: imagesError }, { data: variants, error: variantsError }] = await Promise.all([
    supabaseClient.from('products').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('product_images').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('product_variants').select('*').order('size', { ascending: true })
  ]);
  if (productsError) throw productsError;
  if (imagesError) throw imagesError;
  if (variantsError) throw variantsError;
  return (products || []).map((product) => normalizeProduct(product, images || [], variants || []));
}

async function adminSaveProduct(productId, productData, files = []) {
  const name = String(productData.name || '').trim();
  const description = String(productData.description || '').trim();
  const category = String(productData.category || '').trim() || 'Collection';
  const status = productData.status === 'inactive' ? 'inactive' : 'active';
  const price = Number(productData.price || 0);
  const variants = Array.isArray(productData.variants) && productData.variants.length
    ? productData.variants
    : [{ size: 'OS', stock_quantity: Number(productData.stock_quantity || 0), price }];

  if (!name || !description || !category || !Number.isFinite(price) || price <= 0) {
    throw new Error('Name, description, category, and price are required.');
  }

  const baseProduct = {
    name,
    description,
    category,
    price,
    status
  };

  let savedProduct;
  if (productId) {
    const { data, error } = await supabaseClient
      .from('products')
      .update(baseProduct)
      .eq('id', productId)
      .select('*')
      .single();
    if (error) throw error;
    savedProduct = data;
  } else {
    const { data, error } = await supabaseClient
      .from('products')
      .insert(baseProduct)
      .select('*')
      .single();
    if (error) throw error;
    savedProduct = data;
  }

  const normalizedVariants = variants
    .map((variant) => {
      const size = String(variant.size || 'OS').trim() || 'OS';
      const stockQuantity = Math.max(0, Number(variant.stock_quantity || 0));
      const variantPrice = Number(variant.price || price || 0);
      return {
        product_id: savedProduct.id,
        size,
        color: String(productData.color || '').trim(),
        price: variantPrice,
        stock_quantity: stockQuantity
      };
    })
    .filter((variant) => variant.size);

  const { error: deleteVariantError } = await supabaseClient
    .from('product_variants')
    .delete()
    .eq('product_id', savedProduct.id);
  if (deleteVariantError) throw deleteVariantError;

  if (normalizedVariants.length) {
    const { error: variantError } = await supabaseClient
      .from('product_variants')
      .insert(normalizedVariants);
    if (variantError) throw variantError;
  }

  if (Array.isArray(files) && files.length) {
    const { error: deleteImageError } = await supabaseClient
      .from('product_images')
      .delete()
      .eq('product_id', savedProduct.id);
    if (deleteImageError) throw deleteImageError;
    await uploadProductImages(savedProduct, files);
  }

  return savedProduct;
}

async function adminDeleteProduct(productId) {
  const { error: variantError } = await supabaseClient
    .from('product_variants')
    .delete()
    .eq('product_id', productId);
  if (variantError) throw variantError;

  const { error: imageError } = await supabaseClient
    .from('product_images')
    .delete()
    .eq('product_id', productId);
  if (imageError) throw imageError;

  const { error } = await supabaseClient
    .from('products')
    .delete()
    .eq('id', productId);
  if (error) throw error;
}

// --- Password reset (official Supabase Auth recovery flow) ------------------

async function requestPasswordReset(email) {
  // Sends the official "Reset your password" email: a secure one-time link
  // (which lands on reset.html with a recovery session) plus a 6-digit code
  // that can be entered manually. The redirect target must be allow-listed in
  // Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
  // Unknown addresses are handled with the same neutral response — the site
  // never reveals whether an email is registered.
  const redirectTo = new URL('reset.html', window.location.href).href;
  return supabaseClient.auth.resetPasswordForEmail(email.trim(), { redirectTo });
}

async function verifyRecoveryCode(email, token) {
  // Exchanges the emailed 6-digit code for a recovery session (same pattern as
  // the signup OTP, but with type: 'recovery'). Works in any browser — even
  // one the reset email was not requested from.
  return supabaseClient.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'recovery' });
}

async function updatePassword(newPassword) {
  // Updates the signed-in user's password using the recovery session.
  // Passwords live only inside Supabase Auth — never in the project database.
  return supabaseClient.auth.updateUser({ password: newPassword });
}

function onAuthEvent(handler) {
  // Lets the reset page react when the emailed link's recovery session lands:
  // the client processes the URL tokens right after page load.
  return supabaseClient.auth.onAuthStateChange((event, session) => handler(event, session));
}

// --- Profile page (own-row only; enforced by RLS + scoped queries) ----------

async function getCustomer(user) {
  const { data, error } = await supabaseClient
    .from('customers')
    .select('id,email,full_name,phone,user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateCustomerProfile(user, fields) {
  // RLS ("customers self manage") restricts the update to the caller's own row;
  // the explicit .eq('user_id', ...) makes the scoping visible in code too.
  const { data, error } = await supabaseClient
    .from('customers')
    .update(fields)
    .eq('user_id', user.id)
    .select('id,email,full_name,phone,user_id')
    .single();
  if (error) throw error;
  return data;
}

async function updateUserEmail(newEmail) {
  // Official Supabase Auth email change. Sends a confirmation link to the new
  // address; the email column only flips once it is confirmed (secure default).
  return supabaseClient.auth.updateUser({ email: newEmail.trim() });
}

window.supabaseStore = { getProducts, getProduct, createOrder, uploadProductImages, signUp, signIn, signOut, getSession, getUserCart, saveUserCart, listAddresses, createAddress, placeOrder, getUserOrders, getOrder, updateOrderPaymentStatus, verifySignupEmail, resendSignupCode, requestPasswordReset, verifyRecoveryCode, updatePassword, onAuthEvent, getCustomer, updateCustomerProfile, updateUserEmail, getOrCreateCustomer, isAdmin, adminListOrders, adminOrderItems, adminUpdateOrderStatus, adminLowStock, adminListProducts, adminSaveProduct, adminDeleteProduct };
