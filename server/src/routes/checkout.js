/**
 * Checkout Routes (Supabase Edition + PayTR Integration)
 * /api/checkout/*
 * Handles coupon validation, order creation, PayTR payment processing
 */

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { logger } = require('../services/logger');

const router = express.Router();

// PayTR Configuration (from env)
const PAYTR_MERCHANT_ID = process.env.PAYTR_MERCHANT_ID || '';
const PAYTR_MERCHANT_KEY = process.env.PAYTR_MERCHANT_KEY || '';
const PAYTR_MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://medshifter.app';

// Price configuration
const PRICES = {
    INDIVIDUAL: {
        monthly: { TRY: 380, USD: 19 },
        yearly: { TRY: 190, USD: 5 }  // per month, billed annually
    },
    BUSINESS: {
        monthly: { TRY: 1180, USD: 59 },
        yearly: { TRY: 590, USD: 15 }  // per month, billed annually
    }
};

/**
 * POST /api/checkout/validate-coupon
 * Validate a coupon code
 * Requires authentication
 */
router.post('/validate-coupon', authMiddleware, async (req, res, next) => {
    try {
        const { code, plan } = req.body;

        if (!code) {
            return res.status(400).json({
                error: 'Kupon kodu gerekli',
                code: 3002,
                type: 'MISSING_FIELD'
            });
        }

        const { data: coupon, error } = await req.supabaseAdmin
            .from('coupons')
            .select('*')
            .eq('code', code.toUpperCase())
            .eq('is_active', true)
            .single();

        if (error || !coupon) {
            return res.status(404).json({
                error: 'Geçersiz kupon kodu',
                code: 4002,
                type: 'NOT_FOUND',
                valid: false
            });
        }

        // Check validity period
        const now = new Date();
        if (coupon.valid_from && new Date(coupon.valid_from) > now) {
            return res.status(400).json({
                error: 'Bu kupon henüz aktif değil',
                code: 3001,
                type: 'NOT_YET_VALID',
                valid: false
            });
        }

        if (coupon.valid_until && new Date(coupon.valid_until) < now) {
            return res.status(400).json({
                error: 'Bu kuponun süresi dolmuş',
                code: 3001,
                type: 'EXPIRED',
                valid: false
            });
        }

        // Check max uses
        if (coupon.max_uses > 0 && coupon.current_uses >= coupon.max_uses) {
            return res.status(400).json({
                error: 'Bu kuponun kullanım limiti dolmuş',
                code: 3001,
                type: 'LIMIT_REACHED',
                valid: false
            });
        }

        // Check applicable plans
        if (plan && coupon.applicable_plans && !coupon.applicable_plans.includes(plan)) {
            return res.status(400).json({
                error: 'Bu kupon seçilen plan için geçerli değil',
                code: 3001,
                type: 'NOT_APPLICABLE',
                valid: false
            });
        }

        res.json({
            valid: true,
            coupon: {
                id: coupon.id,
                code: coupon.code,
                discount_percent: coupon.discount_percent,
                applicable_plans: coupon.applicable_plans
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/checkout/init-payment
 * Create order and get PayTR iframe token
 * Requires authentication
 */
router.post('/init-payment', authMiddleware, async (req, res, next) => {
    try {
        const { plan, billing_period, currency, coupon_code } = req.body;

        // Validate plan
        const validPlans = ['INDIVIDUAL', 'BUSINESS'];
        if (!validPlans.includes(plan)) {
            return res.status(400).json({
                error: 'Geçersiz plan',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Validate billing period
        const validPeriods = ['monthly', 'yearly'];
        if (!validPeriods.includes(billing_period)) {
            return res.status(400).json({
                error: 'Geçersiz faturalandırma dönemi',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Validate currency
        const validCurrencies = ['TRY', 'USD'];
        const curr = (currency || 'TRY').toUpperCase();
        if (!validCurrencies.includes(curr)) {
            return res.status(400).json({
                error: 'Geçersiz para birimi',
                code: 3001,
                type: 'VALIDATION_ERROR'
            });
        }

        // Calculate price
        let monthlyPrice = PRICES[plan][billing_period][curr];
        let totalAmount;
        if (billing_period === 'yearly') {
            totalAmount = monthlyPrice * 12;
        } else {
            totalAmount = monthlyPrice;
        }

        // Apply coupon if provided
        let couponId = null;
        let discountPercent = 0;
        if (coupon_code) {
            const { data: coupon } = await req.supabaseAdmin
                .from('coupons')
                .select('*')
                .eq('code', coupon_code.toUpperCase())
                .eq('is_active', true)
                .single();

            if (coupon) {
                const now = new Date();
                const validTime = (!coupon.valid_from || new Date(coupon.valid_from) <= now) &&
                    (!coupon.valid_until || new Date(coupon.valid_until) >= now);
                const validUses = coupon.max_uses === 0 || coupon.current_uses < coupon.max_uses;
                const validPlan = !coupon.applicable_plans || coupon.applicable_plans.includes(plan);

                if (validTime && validUses && validPlan) {
                    couponId = coupon.id;
                    discountPercent = coupon.discount_percent;
                    totalAmount = totalAmount * (1 - discountPercent / 100);

                    // Increment coupon usage
                    await req.supabaseAdmin
                        .from('coupons')
                        .update({ current_uses: coupon.current_uses + 1 })
                        .eq('id', coupon.id);
                }
            }
        }

        const finalAmount = Math.round(totalAmount * 100) / 100;

        // Create order in DB
        const { data: order, error: orderError } = await req.supabaseAdmin
            .from('orders')
            .insert({
                user_id: req.userId,
                plan,
                billing_period,
                amount: finalAmount,
                currency: curr,
                coupon_id: couponId,
                status: 'awaiting_payment',
                payment_provider: 'paytr'
            })
            .select()
            .single();

        if (orderError) throw orderError;

        // Get user email from Supabase auth
        const { data: { user }, error: userError } = await req.supabaseAdmin.auth.admin.getUserById(req.userId);
        if (userError) throw userError;

        const userEmail = user.email || 'customer@medshifter.app';
        const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Müşteri';

        // Get user IP
        const userIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '127.0.0.1';
        // Take first IP if multiple
        const cleanIp = userIp.split(',')[0].trim();

        // PayTR payment amount in kuruş (cents)
        const paymentAmount = Math.round(finalAmount * 100);

        // PayTR currency mapping
        const paytrCurrency = curr === 'TRY' ? 'TL' : curr;

        // Basket JSON (required by PayTR)
        const planName = plan === 'INDIVIDUAL' ? 'Med Shifter Bireysel Plan' : 'Med Shifter Business Plan';
        const periodName = billing_period === 'yearly' ? 'Yıllık' : 'Aylık';
        const basket = JSON.stringify([[`${planName} (${periodName})`, `${finalAmount}`, 1]]);
        const userBasket = Buffer.from(basket).toString('base64');

        // Unique merchant order ID (will be used to match callback)
        const merchantOid = order.id;

        // PayTR URLs
        const merchantOkUrl = `${FRONTEND_URL}/checkout?status=ok&order=${order.id}`;
        const merchantFailUrl = `${FRONTEND_URL}/checkout?status=fail&order=${order.id}`;

        // PayTR settings
        const noInstallment = '0';
        const maxInstallment = '0';
        const testMode = process.env.PAYTR_TEST_MODE || '1';
        const debugOn = process.env.NODE_ENV === 'production' ? '0' : '1';
        const timeoutLimit = '30';
        const lang = 'tr';

        // Generate PayTR token (HMAC SHA256)
        const hashStr = `${PAYTR_MERCHANT_ID}${cleanIp}${merchantOid}${userEmail}${paymentAmount}${userBasket}${noInstallment}${maxInstallment}${paytrCurrency}${testMode}`;
        const paytrToken = crypto
            .createHmac('sha256', PAYTR_MERCHANT_KEY)
            .update(hashStr + PAYTR_MERCHANT_SALT)
            .digest('base64');

        // POST to PayTR to get iframe token
        const formData = new URLSearchParams({
            merchant_id: PAYTR_MERCHANT_ID,
            user_ip: cleanIp,
            merchant_oid: merchantOid,
            email: userEmail,
            payment_amount: paymentAmount.toString(),
            paytr_token: paytrToken,
            user_basket: userBasket,
            debug_on: debugOn,
            no_installment: noInstallment,
            max_installment: maxInstallment,
            user_name: userName,
            user_address: 'Türkiye',
            user_phone: '05555555555',
            merchant_ok_url: merchantOkUrl,
            merchant_fail_url: merchantFailUrl,
            timeout_limit: timeoutLimit,
            currency: paytrCurrency,
            test_mode: testMode,
            lang: lang
        });

        const paytrResponse = await fetch('https://www.paytr.com/odeme/api/get-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });

        const paytrResult = await paytrResponse.json();

        if (paytrResult.status !== 'success') {
            logger.error('PayTR token request failed', {
                reason: paytrResult.reason,
                orderId: order.id
            });

            // Update order status to failed
            await req.supabaseAdmin
                .from('orders')
                .update({ status: 'failed' })
                .eq('id', order.id);

            return res.status(500).json({
                error: 'Ödeme sistemi başlatılamadı: ' + (paytrResult.reason || 'Bilinmeyen hata'),
                code: 5001,
                type: 'PAYMENT_INIT_FAILED'
            });
        }

        logger.info('PayTR payment initiated', {
            userId: req.userId,
            orderId: order.id,
            plan,
            amount: finalAmount,
            currency: curr,
            couponUsed: !!couponId
        });

        res.status(201).json({
            message: 'Ödeme sayfası hazır',
            order: {
                id: order.id,
                plan: order.plan,
                billing_period: order.billing_period,
                amount: order.amount,
                currency: order.currency,
                discount_percent: discountPercent,
                status: order.status
            },
            iframe_token: paytrResult.token
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/checkout/paytr-callback
 * PayTR payment result callback (NO AUTH - called by PayTR servers)
 * This endpoint receives urlencoded POST data from PayTR
 */
router.post('/paytr-callback', express.urlencoded({ extended: true }), async (req, res) => {
    try {
        const { merchant_oid, status, total_amount, hash } = req.body;

        logger.info('PayTR callback received', {
            merchant_oid,
            status,
            total_amount
        });

        // Verify hash to ensure request is from PayTR
        const hashStr = merchant_oid + PAYTR_MERCHANT_SALT + status + total_amount;
        const expectedHash = crypto
            .createHmac('sha256', PAYTR_MERCHANT_KEY)
            .update(hashStr)
            .digest('base64');

        if (hash !== expectedHash) {
            logger.error('PayTR callback: invalid hash', { merchant_oid });
            return res.status(400).send('PAYTR notification failed: bad hash');
        }

        // Check if order already processed (idempotency)
        const { data: existingOrder } = await req.supabaseAdmin
            .from('orders')
            .select('*')
            .eq('id', merchant_oid)
            .single();

        if (!existingOrder) {
            logger.error('PayTR callback: order not found', { merchant_oid });
            return res.send('OK');
        }

        // If already completed or cancelled, just respond OK
        if (existingOrder.status === 'completed' || existingOrder.status === 'cancelled') {
            logger.info('PayTR callback: order already processed, skipping', {
                merchant_oid,
                currentStatus: existingOrder.status
            });
            return res.send('OK');
        }

        if (status === 'success') {
            // Payment successful — update order
            await req.supabaseAdmin
                .from('orders')
                .update({
                    status: 'completed',
                    payment_provider_id: `PAYTR-${merchant_oid}`,
                    updated_at: new Date().toISOString()
                })
                .eq('id', merchant_oid);

            // Upgrade user plan
            const expiresAt = new Date();
            if (existingOrder.billing_period === 'yearly') {
                expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            } else {
                expiresAt.setMonth(expiresAt.getMonth() + 1);
            }

            await req.supabaseAdmin
                .from('profiles')
                .update({
                    plan: existingOrder.plan,
                    plan_expires_at: expiresAt.toISOString(),
                    calendars_used_this_month: 0,
                    saves_used_this_month: 0,
                    exports_used_this_month: 0,
                    usage_reset_at: new Date().toISOString()
                })
                .eq('id', existingOrder.user_id);

            logger.info('Payment successful — user plan upgraded', {
                userId: existingOrder.user_id,
                plan: existingOrder.plan,
                orderId: merchant_oid,
                totalAmount: total_amount
            });
        } else {
            // Payment failed
            await req.supabaseAdmin
                .from('orders')
                .update({
                    status: 'failed',
                    updated_at: new Date().toISOString()
                })
                .eq('id', merchant_oid);

            logger.info('Payment failed', {
                userId: existingOrder.user_id,
                orderId: merchant_oid,
                failedReasonCode: req.body.failed_reason_code,
                failedReasonMsg: req.body.failed_reason_msg
            });
        }

        // PayTR expects "OK" response
        res.send('OK');
    } catch (error) {
        logger.error('PayTR callback error', { error: error.message, stack: error.stack });
        // Still try to send OK so PayTR doesn't retry endlessly
        res.send('OK');
    }
});

/**
 * GET /api/checkout/order-status/:orderId
 * Check order status (for frontend polling)
 * Requires authentication
 */
router.get('/order-status/:orderId', authMiddleware, async (req, res, next) => {
    try {
        const { data: order, error } = await req.supabaseAdmin
            .from('orders')
            .select('id, status, plan, billing_period, amount, currency')
            .eq('id', req.params.orderId)
            .eq('user_id', req.userId)
            .single();

        if (error || !order) {
            return res.status(404).json({
                error: 'Sipariş bulunamadı',
                code: 4001,
                type: 'NOT_FOUND'
            });
        }

        res.json({ order });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/checkout/prices
 * Get current prices (no auth needed)
 */
router.get('/prices', (req, res) => {
    res.json({ prices: PRICES });
});

module.exports = router;
