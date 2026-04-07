/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Version: 1.0.1
 */

import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, DollarSign, Target, Rocket, Loader2, Sparkles, ShoppingBag, CheckCircle2, LogIn, LogOut, User as UserIcon, History, X, Clock, Share2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { getProductRecommendations } from './services/geminiService';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, handleFirestoreError, FirestoreOperationType, sendEmailVerification, reload } from './firebase';
import { doc, onSnapshot, setDoc, updateDoc, getDoc, serverTimestamp, collection, addDoc, query, orderBy, limit } from 'firebase/firestore';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-red-100">
            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-red-600">⚠️</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Algo salió mal</h2>
            <p className="text-slate-600 mb-6">Hubo un error inesperado. Por favor, intenta recargar la página.</p>
            {this.state.error && (
              <div className="bg-slate-50 p-3 rounded-lg text-left mb-6 overflow-auto max-h-32">
                <code className="text-xs text-red-500">{this.state.error.toString()}</code>
              </div>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all"
            >
              Recargar Página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

declare global {
  interface Window {
    paypal?: any;
  }
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<{ credits: number, isPro: boolean } | null>(null);
  const [searchHistory, setSearchHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [verificationSent, setVerificationSent] = useState(false);
  const [niche, setNiche] = useState('');
  const [budget, setBudget] = useState('bajo');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [adCountdown, setAdCountdown] = useState(5);

  const isProAccount = userData?.isPro || 
    user?.email === 'yosefamse@gmail.com' || 
    user?.email === 'amselemyosef@gmail.com';

  const [showPricing, setShowPricing] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [paypalLoaded, setPaypalLoaded] = useState(false);
  const [localCredits, setLocalCredits] = useState<number>(parseInt(localStorage.getItem('localCredits') || '20'));

  const DAILY_LIMIT = 5;
  const today = new Date().toISOString().split('T')[0];

  const startAdTimer = (callback: () => void) => {
    setShowAdModal(true);
    setAdCountdown(5);
    const timer = setInterval(() => {
      setAdCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // Store the callback to be called when the user clicks "Continue"
    // We'll use a ref or just rely on the modal button's existing logic
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsEmailVerified(currentUser.emailVerified);
        
        if (!currentUser.emailVerified && !verificationSent) {
          try {
            await sendEmailVerification(currentUser);
            setVerificationSent(true);
          } catch (error) {
            console.error("Error sending verification email:", error);
          }
        }

        // Create user doc if it doesn't exist
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          const isAdmin = currentUser.email === 'yosefamse@gmail.com' || 
                          currentUser.email === 'amselemyosef@gmail.com';

          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              credits: isAdmin ? 999999 : 200,
              isPro: isAdmin,
              role: isAdmin ? 'admin' : 'user',
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, FirestoreOperationType.WRITE, `users/${currentUser.uid}`);
        }
      } else {
        setUserData(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time User Data Listener
  useEffect(() => {
    if (!user) {
      setUserData(null);
      return;
    }
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        setUserData(doc.data() as any);
      } else {
        // If doc doesn't exist yet, it's being created by the auth listener
        setUserData({ credits: 200, isPro: false });
      }
    }, (error) => {
      handleFirestoreError(error, FirestoreOperationType.GET, `users/${user.uid}`);
    });
    return () => unsubscribe();
  }, [user]);

  // Search History Listener
  useEffect(() => {
    if (!user) {
      setSearchHistory([]);
      return;
    }
    const searchesRef = collection(db, 'users', user.uid, 'searches');
    const q = query(searchesRef, orderBy('timestamp', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSearchHistory(history);
    }, (error) => {
      handleFirestoreError(error, FirestoreOperationType.GET, `users/${user.uid}/searches`);
    });
    return () => unsubscribe();
  }, [user]);

  // PayPal SDK Loader
  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    if (!clientId || clientId === "YOUR_PAYPAL_CLIENT_ID") {
      console.warn("PayPal Client ID is missing or using placeholder. PayPal buttons will not load.");
      return;
    }

    const scriptId = 'paypal-sdk-script';
    if (document.getElementById(scriptId)) {
      setPaypalLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
    script.addEventListener('load', () => setPaypalLoaded(true));
    document.body.appendChild(script);

    // Initialize local credits if not present
    if (!localStorage.getItem('localCredits')) {
      localStorage.setItem('localCredits', '20');
    }
  }, []);

  // PayPal Buttons Renderer
  useEffect(() => {
    if (paypalLoaded && showPricing && window.paypal && user) {
      const renderButtons = (containerId: string, amount: string) => {
        const container = document.getElementById(containerId);
        if (container && container.innerHTML === "") {
          window.paypal.Buttons({
            createOrder: (data: any, actions: any) => {
              return actions.order.create({
                purchase_units: [{
                  amount: { value: amount },
                  payee: { email_address: 'Yosefamse@gmail.com' }
                }]
              });
            },
            onApprove: async (data: any, actions: any) => {
              try {
                const details = await actions.order.capture();
                const userRef = doc(db, 'users', user.uid);
                
                if (amount === '1.99') {
                  // Micro-transaction: 200 credits
                  await updateDoc(userRef, {
                    credits: (userData?.credits || 0) + 200
                  });
                  alert("¡Gracias! Se han añadido 200 créditos a tu cuenta.");
                } else {
                  // Subscription: Pro status
                  await updateDoc(userRef, {
                    isPro: true,
                    credits: 9999
                  });
                  alert("¡Felicidades! Ahora eres usuario PRO.");
                }
                
                setShowPricing(false);
              } catch (error) {
                handleFirestoreError(error, FirestoreOperationType.UPDATE, `users/${user.uid}`);
              }
            }
          }).render(`#${containerId}`);
        }
      };

      renderButtons('paypal-button-credits', '1.99');
      renderButtons('paypal-button-monthly', '9.99');
      renderButtons('paypal-button-yearly', '79.00');
    }
  }, [paypalLoaded, showPricing, showAdModal, user, userData]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error logging in:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!niche) return;
    
    if (!user) {
      if (localCredits < 20) {
        handleLogin();
        return;
      }
      
      // Check local daily limit
      const localLastDate = localStorage.getItem('localLastSearchDate');
      const localCount = parseInt(localStorage.getItem('localDailySearchCount') || '0');
      
      if (localLastDate === today && localCount >= DAILY_LIMIT) {
        setShowLimitModal(true);
        return;
      }

      // Always show ads for non-logged users
      startAdTimer(performSearch);
      return;
    } else if (userData && !isProAccount) {
      // Check daily limit for logged users
      const userLastDate = (userData as any).lastSearchDate;
      const userCount = (userData as any).dailySearchCount || 0;

      if (userLastDate === today && userCount >= DAILY_LIMIT) {
        setShowLimitModal(true);
        return;
      }

      if (userData.credits < 20) {
        setShowPricing(true);
        return;
      }
    }

    // Interstitial Ad for non-PRO users
    if (!isProAccount) {
      startAdTimer(performSearch);
      return;
    }

    performSearch();
  };

  const performSearch = async () => {
    setLoading(true);
    setResult(null);
    const recommendations = await getProductRecommendations(niche, budget);
    setResult(recommendations);

    if (user) {
      const userRef = doc(db, 'users', user.uid);
      const searchesRef = collection(db, 'users', user.uid, 'searches');
      
      try {
        // Save search to history
        await addDoc(searchesRef, {
          niche,
          budget,
          result: recommendations,
          timestamp: serverTimestamp()
        });

        // Decrement credits and increment daily count if not pro
        if (!isProAccount) {
          const currentCount = (userData as any)?.lastSearchDate === today ? ((userData as any)?.dailySearchCount || 0) : 0;
          await updateDoc(userRef, {
            credits: Math.max(0, (userData?.credits || 0) - 20),
            dailySearchCount: currentCount + 1,
            lastSearchDate: today
          });
        }
      } catch (error) {
        handleFirestoreError(error, FirestoreOperationType.WRITE, `users/${user.uid}/searches`);
      }
    } else {
      // Decrement local credits and increment local daily count
      const currentLocalCredits = parseInt(localStorage.getItem('localCredits') || '20');
      const newLocalCredits = Math.max(0, currentLocalCredits - 20);
      localStorage.setItem('localCredits', newLocalCredits.toString());
      setLocalCredits(newLocalCredits);

      const localLastDate = localStorage.getItem('localLastSearchDate');
      const localCount = localLastDate === today ? parseInt(localStorage.getItem('localDailySearchCount') || '0') : 0;
      localStorage.setItem('localDailySearchCount', (localCount + 1).toString());
      localStorage.setItem('localLastSearchDate', today);
    }
    setLoading(false);
  };

  const handleShare = async () => {
    if (!result) return;

    const shareData = {
      title: 'DropshipGenius AI - Producto Ganador',
      text: `He encontrado un producto ganador para el nicho "${niche}" usando DropshipGenius IA. ¡Mira el análisis!`,
      url: window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback to copy to clipboard
      try {
        await navigator.clipboard.writeText(`${shareData.text}\n\n${result}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Error copying to clipboard:', err);
      }
    }
  };

  const handleReRunSearch = (item: any) => {
    setNiche(item.niche);
    setBudget(item.budget);
    setResult(item.result);
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCheckVerification = async () => {
    if (auth.currentUser) {
      await reload(auth.currentUser);
      setIsEmailVerified(auth.currentUser.emailVerified);
      if (auth.currentUser.emailVerified) {
        alert("¡Correo verificado con éxito!");
      } else {
        alert("El correo aún no ha sido verificado. Por favor, revisa tu bandeja de entrada.");
      }
    }
  };

  const handleResendVerification = async () => {
    if (auth.currentUser) {
      try {
        await sendEmailVerification(auth.currentUser);
        alert("Se ha enviado un nuevo correo de verificación.");
      } catch (error) {
        alert("Error al enviar el correo. Inténtalo de nuevo más tarde.");
      }
    }
  };

  const niches = [
    "Hogar y Cocina", "Belleza y Cuidado Personal", "Mascotas", 
    "Fitness y Salud", "Gadgets Tecnológicos", "Moda y Accesorios",
    "Juguetes y Bebés", "Deportes y Aire Libre", "Automotriz", 
    "Joyería", "Papelería y Oficina", "Herramientas y Bricolaje",
    "Viajes y Equipaje", "Libros y Educación", "Arte y Manualidades"
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-800">DropshipGenius</span>
          </div>
          
          <div className="flex items-center gap-4">
            {user && (
              <button 
                onClick={() => setShowHistory(true)}
                className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all relative"
                title="Historial de búsquedas"
              >
                <History className="w-5 h-5" />
                {searchHistory.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-600 rounded-full border-2 border-white" />
                )}
              </button>
            )}
            {user ? (
              <>
                <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border ${isProAccount ? 'bg-green-50 border-green-200' : 'bg-slate-100 border-slate-200'}`}>
                  {isProAccount ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-xs font-bold text-green-600">Plan PRO Activo</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-600">{userData?.credits ?? 0} Créditos</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-slate-50 p-1 pr-3 rounded-full border border-slate-200">
                  <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-slate-200" />
                  <span className="text-sm font-medium text-slate-700 hidden sm:inline">{user.displayName?.split(' ')[0]}</span>
                  <button onClick={handleLogout} className="p-1 hover:text-red-600 transition-colors">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border bg-slate-100 border-slate-200">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-600">{localCredits} Créditos Gratis</span>
                </div>
                <button 
                  onClick={handleLogin}
                  className="flex flex-col items-center bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100 group"
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <LogIn className="w-4 h-4" />
                    Iniciar Sesión
                  </div>
                  <span className="text-[10px] opacity-80 font-medium group-hover:opacity-100">+200 Créditos Gratis</span>
                </button>
              </div>
            )}
            {user && !userData?.isPro && (
              <button 
                onClick={() => setShowPricing(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-xl transition-all shadow-lg shadow-indigo-100"
              >
                Mejorar a PRO
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Search History Sidebar */}
        <AnimatePresence>
          {showHistory && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHistory(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-xl font-bold text-slate-800">Historial</h2>
                  </div>
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {searchHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Clock className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-slate-500">No tienes búsquedas recientes.</p>
                    </div>
                  ) : (
                    searchHistory.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleReRunSearch(item)}
                        className="w-full text-left p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                            {item.budget.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {item.timestamp?.toDate ? new Date(item.timestamp.toDate()).toLocaleDateString() : 'Reciente'}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-800 group-hover:text-indigo-700 transition-colors line-clamp-1">
                          {item.niche}
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2 italic">
                          {item.result.substring(0, 100)}...
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Interstitial Ad Modal */}
        <AnimatePresence>
          {showAdModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-[2.5rem] p-8 md:p-12 max-w-lg w-full shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 blur-2xl" />
                
                <div className="relative text-center">
                  <div className="bg-amber-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Sparkles className="w-8 h-8 text-amber-600" />
                  </div>
                  
                  <h2 className="text-2xl font-black text-slate-900 mb-2">Preparando tu Análisis</h2>
                  <p className="text-slate-500 mb-8">
                    Nuestra IA está procesando los datos del mercado para encontrarte los mejores productos. Este proceso toma unos segundos.
                  </p>

                  <div className="bg-indigo-50/50 rounded-3xl p-8 mb-8 flex flex-col items-center justify-center border border-indigo-100">
                    <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                    <p className="text-indigo-900 font-bold">Analizando tendencias...</p>
                    <p className="text-xs text-indigo-600 mt-2">Suscríbete a PRO para saltar esta espera</p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button 
                      disabled={adCountdown > 0}
                      onClick={() => {
                        setShowAdModal(false);
                        performSearch();
                      }}
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2"
                    >
                      {adCountdown > 0 ? (
                        <>Esperando ({adCountdown}s)...</>
                      ) : (
                        <>Continuar al Análisis <Rocket className="w-5 h-5" /></>
                      )}
                    </button>
                    
                    <button 
                      onClick={() => {
                        setShowAdModal(false);
                        setShowPricing(true);
                      }}
                      className="text-indigo-600 text-sm font-bold hover:underline"
                    >
                      Eliminar anuncios con el Plan PRO →
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Limit Reached Modal */}
        <AnimatePresence>
          {showLimitModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
              onClick={() => setShowLimitModal(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[2.5rem] p-8 md:p-12 max-w-lg w-full shadow-2xl relative overflow-hidden text-center"
                onClick={e => e.stopPropagation()}
              >
                <div className="bg-red-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-8 h-8 text-red-600" />
                </div>
                
                <h2 className="text-2xl font-black text-slate-900 mb-2">Límite Diario Alcanzado</h2>
                <p className="text-slate-500 mb-8">
                  Has alcanzado tu límite de {DAILY_LIMIT} búsquedas diarias gratuitas. Vuelve mañana o mejora a PRO para búsquedas ilimitadas.
                </p>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      setShowLimitModal(false);
                      setShowPricing(true);
                    }}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                  >
                    Mejorar a PRO <Sparkles className="w-5 h-5" />
                  </button>
                  
                  <button 
                    onClick={() => setShowLimitModal(false)}
                    className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-2xl transition-all"
                  >
                    Entendido, volveré mañana
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pricing Modal */}
        <AnimatePresence>
          {showPricing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowPricing(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl border border-slate-100"
                onClick={e => e.stopPropagation()}
              >
                <div className="text-center mb-8">
                  <div className="bg-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Rocket className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Desbloquea el Potencial Pro</h2>
                  <p className="text-slate-500">Escala tu negocio de dropshipping con análisis ilimitados.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="border-2 border-slate-100 p-6 rounded-2xl hover:border-indigo-200 transition-all bg-slate-50/50">
                    <h3 className="font-bold text-lg mb-1">Pack Básico</h3>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-3xl font-extrabold text-slate-900">$1.99</span>
                      <span className="text-slate-500 text-sm">/pago único</span>
                    </div>
                    <ul className="space-y-3 text-sm text-slate-600 mb-6">
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        200 Créditos Extra
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        10 Búsquedas IA
                      </li>
                    </ul>
                    <div id="paypal-button-credits" className="min-h-[45px]"></div>
                  </div>

                  <div className="border-2 border-slate-100 p-6 rounded-2xl hover:border-indigo-200 transition-all">
                    <h3 className="font-bold text-lg mb-1">Plan Mensual</h3>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-3xl font-extrabold text-slate-900">$9.99</span>
                      <span className="text-slate-500 text-sm">/mes</span>
                    </div>
                    <ul className="space-y-3 text-sm text-slate-600 mb-6">
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Búsquedas Ilimitadas
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Proveedores VIP
                      </li>
                    </ul>
                    <div id="paypal-button-monthly" className="min-h-[45px]"></div>
                  </div>

                  <div className="border-2 border-indigo-600 p-6 rounded-2xl relative bg-indigo-50/30">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                      Mejor Valor
                    </div>
                    <h3 className="font-bold text-lg mb-1">Plan Anual</h3>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-3xl font-extrabold text-slate-900">$79</span>
                      <span className="text-slate-500 text-sm">/año</span>
                    </div>
                    <ul className="space-y-3 text-sm text-slate-600 mb-6">
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Todo lo de Mensual
                      </li>
                      <li className="flex items-center gap-2 font-bold text-indigo-600">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Ahorra 35%
                      </li>
                    </ul>
                    <div id="paypal-button-yearly" className="min-h-[45px]"></div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowPricing(false)}
                  className="mt-8 text-slate-400 text-sm hover:text-slate-600 transition-colors w-full text-center"
                >
                  Continuar con versión gratuita
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hero Section */}
        <div className="text-center mb-16">
          {user && !isEmailVerified && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 bg-amber-50 border border-amber-200 p-6 rounded-3xl text-amber-800 flex flex-col md:flex-row items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="bg-amber-100 p-2 rounded-xl">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="font-bold">Verifica tu correo electrónico</p>
                  <p className="text-sm opacity-90">Debes verificar tu correo para usar el buscador de productos.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleCheckVerification}
                  className="bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-amber-700 transition-all"
                >
                  Ya lo verifiqué
                </button>
                <button 
                  onClick={handleResendVerification}
                  className="bg-white text-amber-600 border border-amber-200 text-xs font-bold px-4 py-2 rounded-xl hover:bg-amber-50 transition-all"
                >
                  Reenviar correo
                </button>
              </div>
            </motion.div>
          )}

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight"
          >
            Encuentra tu próximo <span className="text-indigo-600">Producto Ganador</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-600 max-w-2xl mx-auto"
          >
            Analizamos miles de tendencias con Inteligencia Artificial para recomendarte los productos con mayor potencial de ventas hoy mismo.
          </motion.p>
        </div>

        {/* Search Form */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 mb-12"
        >
          <form onSubmit={handleSearch} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 ml-1">¿En qué nicho estás interesado?</label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input 
                    type="text" 
                    placeholder="Ej: Accesorios para gatos, Cocina saludable..."
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 ml-1">Presupuesto de Marketing</label>
                <select 
                  className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all appearance-none"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                >
                  <option value="micro">Micro (Menos de $50)</option>
                  <option value="muy_bajo">Muy Bajo ($50 - $200)</option>
                  <option value="bajo">Bajo ($200 - $500)</option>
                  <option value="medio">Medio ($500 - $2000)</option>
                  <option value="alto">Alto ($2000 - $5000)</option>
                  <option value="premium">Premium (Más de $5000)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {niches.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNiche(n)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    niche === n 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <button 
              type="submit"
              disabled={loading || !niche || (user !== null && !isEmailVerified)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 text-lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Analizando mercado...
                </>
              ) : (
                <>
                  <Sparkles className="w-6 h-6" />
                  {user ? (isEmailVerified ? 'Generar Recomendaciones IA' : 'Verifica tu correo para continuar') : `Probar Gratis (${localCredits / 20} Búsquedas)`}
                </>
              )}
            </button>
          </form>
        </motion.div>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {result && (
            <div className="space-y-8">
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -30 }}
                className="relative bg-white rounded-[2.5rem] p-8 md:p-14 shadow-[0_20px_50px_rgba(79,70,229,0.1)] border border-indigo-50 overflow-hidden"
              >
                {/* Decorative background elements */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-50/50 rounded-full -ml-32 -mb-32 blur-3xl pointer-events-none" />

                <div className="relative flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6 pb-8 border-b border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 p-3 rounded-2xl shadow-lg shadow-emerald-100">
                      <TrendingUp className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <div className="flex flex-wrap gap-2 mb-1">
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase tracking-wider border border-indigo-100">
                          {niche}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                          Presupuesto {budget}
                        </span>
                      </div>
                      <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                        Análisis Estratégico
                      </h2>
                    </div>
                  </div>
                  <button 
                    onClick={handleShare}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 hover:bg-indigo-600 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-slate-200 hover:shadow-indigo-200 group"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        ¡Copiado!
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                        Compartir Éxito
                      </>
                    )}
                  </button>
                </div>
                
                <div className="relative prose prose-slate max-w-none 
                  prose-headings:text-indigo-600 prose-headings:font-black prose-headings:tracking-tight
                  prose-strong:text-slate-900 prose-strong:font-bold
                  prose-p:text-slate-600 prose-p:leading-relaxed prose-p:text-lg
                  prose-li:text-slate-600 prose-li:text-lg
                  prose-img:rounded-3xl prose-img:shadow-lg
                  prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50/50 prose-blockquote:p-4 prose-blockquote:rounded-r-2xl prose-blockquote:italic">
                  <Markdown>{result}</Markdown>
                </div>

                <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <DollarSign className="w-8 h-8 text-indigo-600 mb-4" />
                    <h3 className="font-bold mb-2">Rentabilidad</h3>
                    <p className="text-sm text-slate-600">Productos con márgenes superiores al 30% tras gastos de envío.</p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <Target className="w-8 h-8 text-indigo-600 mb-4" />
                    <h3 className="font-bold mb-2">Segmentación</h3>
                    <p className="text-sm text-slate-600">Nichos específicos con baja competencia y alta demanda.</p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <Rocket className="w-8 h-8 text-indigo-600 mb-4" />
                    <h3 className="font-bold mb-2">Escalabilidad</h3>
                    <p className="text-sm text-slate-600">Estrategias probadas para pasar de 0 a 100 ventas diarias.</p>
                  </div>
                </div>

                {!isProAccount && (
                  <div className="mt-12 p-8 bg-gradient-to-r from-indigo-600 to-indigo-800 rounded-3xl text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl shadow-indigo-200">
                    <div className="flex items-center gap-4 text-left">
                      <div className="bg-white/20 p-3 rounded-2xl">
                        <Sparkles className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg">¿Quieres más resultados?</h4>
                        <p className="text-sm opacity-80">El Plan PRO te da acceso ilimitado y proveedores VIP.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowPricing(true)}
                      className="bg-white text-indigo-600 font-bold px-6 py-3 rounded-2xl hover:bg-indigo-50 transition-all whitespace-nowrap"
                    >
                      Mejorar a PRO ahora
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Empty State / Tips */}
        {!result && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
            <div className="bg-indigo-50 p-8 rounded-3xl border border-indigo-100">
              <h3 className="text-xl font-bold text-indigo-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                ¿Qué es un producto ganador?
              </h3>
              <ul className="space-y-3 text-indigo-800/80">
                <li className="flex gap-2">
                  <span className="text-indigo-600 font-bold">•</span>
                  Resuelve un problema cotidiano o ahorra tiempo.
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-600 font-bold">•</span>
                  Tiene un "Efecto Wow" visual para anuncios.
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-600 font-bold">•</span>
                  No es fácil de encontrar en tiendas físicas locales.
                </li>
                <li className="flex gap-2">
                  <span className="text-indigo-600 font-bold">•</span>
                  Permite un margen de beneficio saludable.
                </li>
              </ul>
            </div>
            <div className="bg-slate-900 p-8 rounded-3xl text-white">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Rocket className="w-5 h-5 text-indigo-400" />
                Consejo Pro
              </h3>
              <p className="text-slate-300 leading-relaxed">
                "No te enamores del producto, enamórate del proceso. Prueba 3-5 productos a la vez con presupuestos pequeños en TikTok Ads para encontrar el que realmente escala."
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center font-bold">DG</div>
                <div>
                  <p className="font-bold text-sm">Equipo DropshipGenius</p>
                  <p className="text-xs text-slate-400">Expertos en E-commerce</p>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* FAQ Section */}
        <div className="mt-24 max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-black text-slate-900 mb-4">Preguntas Frecuentes</h2>
            <p className="text-slate-500">Todo lo que necesitas saber sobre DropshipGenius IA.</p>
          </div>
          
          <div className="space-y-4">
            {[
              {
                q: "¿Cómo funciona la IA de DropshipGenius?",
                a: "Analizamos tendencias globales, datos de redes sociales y marketplaces en tiempo real usando modelos avanzados de Google (Gemini) para identificar productos con alta demanda y baja competencia."
              },
              {
                q: "¿Qué criterios se usan para seleccionar los productos?",
                a: "Evaluamos el potencial de margen de beneficio, la facilidad de envío, la saturación del mercado y la 'viralidad' visual del producto para asegurar que sea apto para anuncios en TikTok o Facebook."
              },
              {
                q: "¿Cuáles son los beneficios del Plan PRO?",
                a: "El Plan PRO ofrece búsquedas ilimitadas, acceso a proveedores VIP con mejores precios, análisis de competencia profundos y soporte prioritario. Además, eliminas los anuncios y las esperas de 5 segundos."
              },
              {
                q: "¿Cómo funcionan los créditos?",
                a: "Cada búsqueda exitosa consume 20 créditos. Al registrarte, recibes un bono de 200 créditos gratis. Si te quedas sin créditos, puedes comprar packs o suscribirte al Plan PRO para acceso ilimitado."
              }
            ].map((faq, index) => (
              <motion.div 
                key={index}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all"
              >
                <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-600" />
                  {faq.q}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed ml-4">
                  {faq.a}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-12 mt-20">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-slate-500 text-sm">
            © 2026 DropshipGenius AI. Impulsado por Google Gemini.
          </p>
          <p className="text-slate-400 text-xs mt-2">
            Los datos proporcionados son estimaciones basadas en tendencias de mercado actuales.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
