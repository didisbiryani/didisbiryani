import { db, collection, addDoc, getDocs, doc, updateDoc, setDoc, query, where } from './firebase-config.js';

/**
 * Sweeps the user's wallet entries, marks expired ones as remainingAmount = 0,
 * and updates the cached walletBalance on the user profile.
 * 
 * @param {string} userId - The user's UID.
 * @returns {Promise<number>} The updated active wallet balance.
 */
export async function expireUserWalletEntries(userId) {
    const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    const entriesRef = collection(db, "users", userId, "walletEntries");
    const q = query(entriesRef, where("remainingAmount", ">", 0));
    
    try {
        const querySnapshot = await getDocs(q);
        let activeTotal = 0;
        
        for (const docSnap of querySnapshot.docs) {
            const entry = docSnap.data();
            // If the entry has an expiryDate that is NOT "never", and is strictly before today's date
            if (entry.expiryDate && entry.expiryDate !== 'never' && entry.expiryDate < todayStr) {
                await updateDoc(doc(db, "users", userId, "walletEntries", docSnap.id), {
                    remainingAmount: 0,
                    expired: true,
                    expiredAt: new Date().toISOString()
                });
            } else {
                activeTotal += Number(entry.remainingAmount) || 0;
            }
        }
        
        // Update user's cached walletBalance
        const userRef = doc(db, "users", userId);
        await setDoc(userRef, {
            walletBalance: activeTotal
        }, { merge: true });
        
        return activeTotal;
    } catch (e) {
        console.error("Error expiring wallet entries:", e);
        return 0;
    }
}

/**
 * Consumes the user's wallet balance in FIFO order (soonest expiring consumed first).
 * 
 * @param {string} userId - The user's UID.
 * @param {number} amountToDeduct - The total wallet amount to consume.
 * @returns {Promise<number>} The updated active wallet balance.
 */
export async function consumeWalletEntries(userId, amountToDeduct) {
    if (amountToDeduct <= 0) return 0;
    
    const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    const entriesRef = collection(db, "users", userId, "walletEntries");
    const q = query(entriesRef, where("remainingAmount", ">", 0));
    
    try {
        const querySnapshot = await getDocs(q);
        const activeEntries = [];
        
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.expiryDate || data.expiryDate === 'never' || data.expiryDate >= todayStr) {
                activeEntries.push({ id: docSnap.id, ...data });
            }
        });
        
        // Sort entries by expiryDate ascending: soonest to expire first.
        // "never" goes to the very end.
        activeEntries.sort((a, b) => {
            if (a.expiryDate === 'never' && b.expiryDate === 'never') return 0;
            if (a.expiryDate === 'never') return 1;
            if (b.expiryDate === 'never') return -1;
            return a.expiryDate.localeCompare(b.expiryDate);
        });
        
        let remainingDeduct = amountToDeduct;
        for (const entry of activeEntries) {
            if (remainingDeduct <= 0) break;
            
            const available = entry.remainingAmount;
            const deductNow = Math.min(remainingDeduct, available);
            const newRemaining = available - deductNow;
            
            await updateDoc(doc(db, "users", userId, "walletEntries", entry.id), {
                remainingAmount: newRemaining
            });
            
            remainingDeduct -= deductNow;
        }
        
        // Re-sum active entries and update cache
        const finalSnapshot = await getDocs(q);
        let activeTotal = 0;
        finalSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.expiryDate || data.expiryDate === 'never' || data.expiryDate >= todayStr) {
                activeTotal += Number(data.remainingAmount) || 0;
            }
        });
        
        await setDoc(doc(db, "users", userId), {
            walletBalance: activeTotal
        }, { merge: true });
        
        return activeTotal;
    } catch (e) {
        console.error("Error consuming wallet entries:", e);
        return 0;
    }
}

/**
 * Adds a new wallet ledger entry for a user and refreshes their cached walletBalance.
 * 
 * @param {string} userId - The user's UID.
 * @param {number} amount - The amount to credit.
 * @param {string} expiryDate - Expiry date string (YYYY-MM-DD) or empty.
 * @param {string} type - The type of credit ('gift', 'credit_all', 'loyalty').
 */
export async function addWalletEntry(userId, amount, expiryDate, type) {
    const entriesRef = collection(db, "users", userId, "walletEntries");
    const cleanExpiry = expiryDate && expiryDate.trim() !== '' ? expiryDate : 'never';
    
    const entryData = {
        amount: Number(amount),
        remainingAmount: Number(amount),
        expiryDate: cleanExpiry,
        type: type,
        createdAt: new Date().toISOString()
    };
    
    await addDoc(entriesRef, entryData);
    
    // Sweep and recalculate total cached balance
    await expireUserWalletEntries(userId);
}
