package com.calculator.exception;

/** Raised when a requested operation symbol is not registered. */
public class UnknownOperationException extends CalculatorException {

    public UnknownOperationException(String symbol) {
        super("No operation is registered for symbol: '" + symbol + "'");
    }
}
