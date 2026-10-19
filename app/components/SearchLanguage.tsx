"use client";
import { createContext, useContext } from "react";
export const SearchLanguage = createContext("ko");
export const useSearchLanguage = () => useContext(SearchLanguage);
